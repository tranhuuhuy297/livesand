// Completes the calibration wizard with real clicks in the projector app (not the harness), so HUD styles or layers
// that swallow wizard input are caught.
import { expect, test } from '@playwright/test';
import { startFakeDepthSource } from '../../server/fake-depth-source';
import { startRelayServer } from '../../server/relay-server';
import type {} from '../../src/app/physical/physical-mode-controller';
import { APP_TEST_OPTIONS, SCREENS_DIR, openApp, watchConsole } from './app-e2e-test-helpers';

test.use(APP_TEST_OPTIONS);

test('the calibration wizard can be completed through the projector UI', async ({ page }) => {
  test.setTimeout(120_000);
  const relay = await startRelayServer({ port: 0, host: '127.0.0.1' });
  const fake = startFakeDepthSource({ url: `ws://127.0.0.1:${relay.port}/ws?role=source`, fps: 30 });
  try {
    const problems = watchConsole(page);
    const viewer = `ws://127.0.0.1:${relay.port}/ws?role=viewer`;
    await openApp(page, `?mode=projector&relay=${encodeURIComponent(viewer)}`);

    const wizard = page.locator('.lsp-wizard');
    await expect(wizard).toBeVisible({ timeout: 20_000 });
    const next = wizard.getByRole('button', { name: 'Next', exact: true });

    // Step 1: corners. The side column must sit inside the wizard, not float at the page's top-left.
    const useWhole = wizard.getByRole('button', { name: 'Use whole image' });
    const wizardBox = await wizard.boundingBox();
    const buttonBox = await useWhole.boundingBox();
    expect(wizardBox && buttonBox).toBeTruthy();
    expect(buttonBox!.x).toBeGreaterThanOrEqual(wizardBox!.x);
    expect(buttonBox!.y).toBeGreaterThanOrEqual(wizardBox!.y);
    await useWhole.click();
    await expect(next).toBeEnabled();
    await next.click();

    // Step 2: flat-sand capture (median of several frames), then advance.
    await wizard.getByRole('button', { name: 'Capture flat sand' }).click();
    await expect(next).toBeEnabled({ timeout: 20_000 });
    await next.click();

    // Steps 3-4: relief range and projector keystone keep their defaults.
    await next.click();
    await next.click();

    // Step 5: save.
    await wizard.getByRole('button', { name: 'Save & start' }).click();
    await expect(wizard).toBeHidden({ timeout: 10_000 });

    const calibrated = () => page.evaluate(() => window.__livesandPhysical?.status.calibrated ?? false);
    await expect.poll(calibrated, { timeout: 10_000 }).toBe(true);
    await page.screenshot({ path: `${SCREENS_DIR}app-projector-after-wizard.png` });
    expect(problems).toEqual([]);
  } finally {
    fake.stop();
    await relay.close();
  }
});
