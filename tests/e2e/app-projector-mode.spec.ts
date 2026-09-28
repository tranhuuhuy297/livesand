// End-to-end check of projector-mode wiring: relay + fake LiDAR source -> PhysicalModeController -> sim terrain,
// hand rain and the minimal projector HUD.
import { expect, test } from '@playwright/test';
import { startFakeDepthSource } from '../../server/fake-depth-source';
import { startRelayServer } from '../../server/relay-server';
import type {} from '../../src/app/physical/physical-mode-controller';
import { APP_TEST_OPTIONS, SCREENS_DIR, openApp, watchConsole } from './app-e2e-test-helpers';
import { scaled } from './e2e-timing';

test.use(APP_TEST_OPTIONS);

test('projector mode turns a fake depth stream into terrain and hand rain', async ({ page }) => {
  test.setTimeout(scaled(120_000));
  const relay = await startRelayServer({ port: 0, host: '127.0.0.1' });
  const fake = startFakeDepthSource({ url: `ws://127.0.0.1:${relay.port}/ws?role=source`, fps: 30 });
  try {
    const problems = watchConsole(page);
    const viewer = `ws://127.0.0.1:${relay.port}/ws?role=viewer`;
    await openApp(page, `?mode=projector&relay=${encodeURIComponent(viewer)}`);
    const physical = async () => (await page.evaluate(() => window.__livesand!.debug.state())).physical as { sources: number };
    await expect.poll(async () => (await physical()).sources, { timeout: scaled(15_000) }).toBe(1);
    await expect(page.locator('.ls-projector-hud')).toBeVisible();

    // What a finished wizard saves for a 1 m box seen whole by the phone, 1 m above flat sand.
    await page.evaluate(() => {
      const unit = 256;
      window.__livesandPhysical!.applyCalibration(
        {
          grid: { width: 256, height: 192 },
          depthWidth: 256,
          depthHeight: 192,
          roiQuad: [{ x: 0, y: 0 }, { x: 256, y: 0 }, { x: 256, y: 192 }, { x: 0, y: 192 }],
          referenceDepth: null,
          referencePlaneMeters: 1,
          boxWidthCm: 100,
          unitsPerMeter: unit,
          minHeight: -0.12 * unit,
          maxHeight: 0.2 * unit,
          keystone: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
          savedAt: Date.now(),
        },
        false,
      );
    });
    const relief = () =>
      page.evaluate(() => {
        const h = window.__livesand!.debug.getHeights();
        let lo = Infinity;
        let hi = -Infinity;
        for (const v of h) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
        return hi - lo;
      });
    await expect.poll(relief, { timeout: scaled(15_000) }).toBeGreaterThan(5);
    // The fake "hand" hovers over the box, so rain must start collecting on the sand.
    const water = () => page.evaluate(async () => (await window.__livesand!.debug.readWater()).reduce((s, d) => s + d, 0));
    await expect.poll(water, { timeout: scaled(30_000) }).toBeGreaterThan(1);
    await page.screenshot({ path: `${SCREENS_DIR}app-projector.png` });
    await page.keyboard.press('h');
    await expect(page.locator('.ls-projector-hud')).toBeHidden();
    expect(problems).toEqual([]);
  } finally {
    fake.stop();
    await relay.close();
  }
});
