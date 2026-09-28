// Physical mode end to end: real relay + fake LiDAR source -> pairing panel -> calibration wizard -> live terrain.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { startFakeDepthSource } from '../../server/fake-depth-source';
import { startRelayServer, type RelayServer } from '../../server/relay-server';
import { dragBy, openHarness, stats, status, type Quad4, type TestWindow } from './physical-mode-test-helpers';
import { scaled } from './e2e-timing';

const SCREENS_DIR = fileURLToPath(new URL('../../e2e-screens/', import.meta.url));
const STORAGE_KEY = 'livesand.physical-calibration';

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1440, height: 900 } });

let relay: RelayServer;
let fake: { stop(): void } | null = null;
const relayWs = (role: 'viewer' | 'source') => `ws://127.0.0.1:${relay.port}/ws?role=${role}`;

test.beforeAll(async () => {
  relay = await startRelayServer({ port: 0, host: '127.0.0.1' });
  mkdirSync(SCREENS_DIR, { recursive: true });
});

test.afterAll(async () => {
  fake?.stop();
  await relay?.close();
});

const wizard = (page: Page) => page.getByTestId('calibration-wizard');

test('pairing, calibration wizard and live terrain from a fake depth source', async ({ page }) => {
  test.setTimeout(scaled(120_000));
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error') problems.push(msg.text()); });

  await test.step('pairing panel shows the relay QR while no depth source is connected', async () => {
    await openHarness(page, relayWs('viewer'));
    await expect(page.getByTestId('pairing-panel')).toBeVisible();
    await expect(page.getByTestId('pairing-status')).toContainText('Relay connected', { timeout: scaled(10_000) });
    await expect(page.getByTestId('pairing-qr')).not.toHaveClass(/is-loading/, { timeout: scaled(10_000) });
    expect(await page.locator('.lsp-qr-img').getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    await expect(page.locator('.lsp-url')).toHaveText(relayWs('source'));
    await expect(page.locator('.lsp-cmd')).toContainText(`fake-source --url ${relayWs('source')}`);
    await page.screenshot({ path: `${SCREENS_DIR}physical-pairing.png` });
  });

  await test.step('a live source opens the wizard; corners are clicked on the depth preview', async () => {
    fake = startFakeDepthSource({ url: relayWs('source'), fps: 30 });
    await expect(wizard(page)).toBeVisible({ timeout: scaled(15_000) });
    await expect(page.getByTestId('pairing-panel')).toHaveCount(0);
    await expect(wizard(page)).toHaveAttribute('data-step', '0');
    const stage = page.getByTestId('roi-stage');
    await expect.poll(() => stage.locator('canvas').evaluate((c: HTMLCanvasElement) => c.width)).toBe(256);
    const box = (await stage.boundingBox())!;
    for (const [fx, fy] of [[0.05, 0.06], [0.95, 0.05], [0.96, 0.95], [0.04, 0.94]]) {
      await page.mouse.click(box.x + fx * box.width, box.y + fy * box.height);
    }
    await expect(page.locator('.lsp-corner-item.is-done')).toHaveCount(4);
    await expect(page.getByTestId('wizard-next')).toBeEnabled();
    await page.screenshot({ path: `${SCREENS_DIR}physical-wizard.png` });
  });

  await test.step('flat sand capture, relief range, projector keystone, save', async () => {
    await page.getByTestId('wizard-next').click();
    await expect(wizard(page)).toHaveAttribute('data-step', '1');
    await expect(page.getByTestId('wizard-next')).toBeDisabled();
    await page.getByTestId('capture-reference').click();
    await expect(page.getByTestId('capture-result')).toContainText('Flat sand at', { timeout: scaled(15_000) });
    await page.screenshot({ path: `${SCREENS_DIR}physical-wizard-capture.png` });
    await page.getByTestId('wizard-next').click();

    await expect(wizard(page)).toHaveAttribute('data-step', '2');
    await page.getByTestId('box-width').fill('120');
    await page.getByTestId('box-width').press('Tab');
    await expect(page.locator('.lsp-derived')).toContainText('1 cm of sand = 2.13 height units');
    await page.waitForTimeout(600); // let a few processed frames reach the terrain preview
    await page.screenshot({ path: `${SCREENS_DIR}physical-wizard-relief.png` });
    await page.getByTestId('wizard-next').click();

    await expect(wizard(page)).toHaveAttribute('data-step', '3');
    await expect(page.locator('.lsp-keystone-grid')).toBeVisible();
    await dragBy(page, '.lsp-keystone-layer .lsp-handle[data-corner="0"]', 70, 45);
    await dragBy(page, '.lsp-keystone-layer .lsp-handle[data-corner="2"]', -50, -35);
    const transform = await page.locator('#surface').evaluate((el) => el.style.transform);
    expect(transform).toContain('matrix3d');
    await page.screenshot({ path: `${SCREENS_DIR}physical-keystone.png` });
    await page.getByTestId('wizard-next').click();

    await expect(wizard(page)).toHaveAttribute('data-step', '4');
    await expect(page.getByTestId('wizard-next')).toHaveText('Save & start');
    await page.screenshot({ path: `${SCREENS_DIR}physical-wizard-save.png` });
    await page.getByTestId('wizard-next').click();
    await expect(wizard(page)).toHaveCount(0);
    expect(await page.evaluate((k) => localStorage.getItem(k) !== null, STORAGE_KEY)).toBe(true);
    await expect.poll(async () => (await status(page)).calibrated).toBe(true);
    const keystone = await page.evaluate(() => (window as TestWindow).__livesandPhysical!.calibration!.keystone as Quad4);
    expect(keystone[0].x).toBeGreaterThan(0.03); // TL dragged right/down
    expect(keystone[2].x).toBeLessThan(0.98); // BR dragged left/up from the screen corner
    await expect.poll(async () => (await stats(page)).handCells, { timeout: scaled(10_000) }).toBeGreaterThan(0);
  });

  await test.step('plane-referenced calibration: poll() shows the mound above flat sand and the hovering hand', async () => {
    await page.evaluate(() => {
      const c = (window as TestWindow).__livesandPhysical!;
      const roiQuad: Quad4 = [{ x: 0, y: 0 }, { x: 256, y: 0 }, { x: 256, y: 192 }, { x: 0, y: 192 }];
      c.applyCalibration({ ...c.calibration, roiQuad, referenceDepth: null, referencePlaneMeters: 1.0 }, false);
      (window as TestWindow).__physicalHarness!.resetStats();
    });
    await expect.poll(async () => { const s = await stats(page); return s.maxHeight - s.flat; }, { timeout: scaled(10_000) }).toBeGreaterThan(10);
    const s = await stats(page);
    expect(s.handCells).toBeGreaterThan(0);
    expect(s.flat).toBeGreaterThan(0);
    const st = await status(page);
    expect(st.connected).toBe(true);
    expect(st.sources).toBe(1);
    expect(st.fps).toBeGreaterThan(5);
    expect(st.message).toMatch(/^Live depth 256×192/);
  });

  await test.step('the saved calibration and keystone are reused after a reload', async () => {
    await openHarness(page, relayWs('viewer'));
    await expect.poll(async () => (await stats(page)).polls, { timeout: scaled(10_000) }).toBeGreaterThan(3);
    await expect(wizard(page)).toHaveCount(0);
    await expect(page.getByTestId('pairing-panel')).toHaveCount(0);
    expect((await status(page)).calibrated).toBe(true);
    expect(await page.locator('#surface').evaluate((el) => el.style.transform)).toContain('matrix3d');
  });

  await test.step('re-running the wizard reuses the saved corners and reference; Cancel keeps the calibration', async () => {
    await page.evaluate(() => (window as TestWindow).__livesandPhysical!.openCalibration());
    await expect(wizard(page)).toHaveAttribute('data-step', '0');
    await expect(page.getByTestId('wizard-live')).toHaveText('Live depth');
    await expect(page.locator('.lsp-corner-item.is-done')).toHaveCount(4);
    await page.getByTestId('wizard-next').click();
    await expect(page.getByTestId('capture-result')).toContainText('saved reference');
    await expect(page.getByTestId('wizard-next')).toBeEnabled();
    await expect(page.getByTestId('wizard-close')).toHaveText('Cancel');
    await page.getByTestId('wizard-close').click();
    await expect(wizard(page)).toHaveCount(0);
    expect((await status(page)).calibrated).toBe(true);
  });

  await test.step('losing the depth source brings the pairing panel back after a grace period', async () => {
    fake?.stop();
    fake = null;
    await expect.poll(async () => (await status(page)).sources, { timeout: scaled(10_000) }).toBe(0);
    await expect(page.getByTestId('pairing-panel')).toBeVisible({ timeout: scaled(12_000) });
    expect((await status(page)).connected).toBe(true);
  });

  expect(await page.evaluate(() => (window as TestWindow).__physicalHarness!.errors)).toEqual([]);
  expect(problems).toEqual([]);
});

test('the pairing panel explains an unreachable relay and keeps retrying', async ({ page }) => {
  const probe = await startRelayServer({ port: 0, host: '127.0.0.1' });
  const deadPort = probe.port;
  await probe.close();
  await openHarness(page, `ws://127.0.0.1:${deadPort}/ws?role=viewer`);
  await expect(page.getByTestId('pairing-panel')).toBeVisible();
  await expect(page.getByTestId('pairing-status')).toContainText("Can't reach the relay", { timeout: scaled(10_000) });
  await expect(page.locator('.lsp-relay-note')).toContainText('Is the relay running?', { timeout: scaled(10_000) });
  expect(await status(page)).toMatchObject({ connected: false, sources: 0, fps: 0, calibrated: false });
  await page.screenshot({ path: `${SCREENS_DIR}physical-pairing-offline.png` });
});
