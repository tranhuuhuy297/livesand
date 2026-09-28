// End-to-end checks of virtual mode in headless Chromium WebGPU: boot, sculpting, winning and losing a level,
// 2D/3D switching, the WebGPU-unavailable screen, plus screenshots for visual review.
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  APP_TEST_OPTIONS,
  SCREENS_DIR,
  appState,
  dragOnCanvas,
  heightsDelta,
  openApp,
  stepFrames,
  watchConsole,
} from './app-e2e-test-helpers';

test.use(APP_TEST_OPTIONS);

test.beforeAll(() => mkdirSync(SCREENS_DIR, { recursive: true }));

test('boots into the first level briefing without console errors', async ({ page }) => {
  const problems = watchConsole(page);
  await openApp(page, '?level=first-flood&view=2d');
  const state = await appState(page);
  expect(state.level).toBe('first-flood');
  expect(state.phase).toBe('ready');
  expect(state.view).toBe('2d');
  await expect(page.locator('.ls-intro')).toBeVisible();
  await expect(page.locator('.ls-intro .ls-card-title')).toHaveText('First Flood');
  await expect(page.locator('.ls-village')).toHaveCount(1);
  await page.keyboard.press('1');
  expect((await appState(page)).tool).toBe('raise');
  await page.locator('.ls-tool[data-tool="rain"]').click();
  expect((await appState(page)).tool).toBe('rain');
  expect(state.gpuErrors).toEqual([]);
  expect(problems).toEqual([]);
});

test('mouse sculpting changes the heightmap in 2D and 3D', async ({ page }) => {
  const problems = watchConsole(page);
  await openApp(page, '?level=sandbox&view=2d');
  await page.keyboard.press('1');
  const raised2d = await heightsDelta(page, () => dragOnCanvas(page, 700));
  expect(raised2d.changed).toBeGreaterThan(50);
  expect(raised2d.maxAbs).toBeGreaterThan(0.2);

  await page.keyboard.press('v');
  await expect.poll(async () => (await appState(page)).view).toBe('3d');
  await page.keyboard.press('2');
  const dug3d = await heightsDelta(page, () => dragOnCanvas(page, 700));
  expect(dug3d.changed).toBeGreaterThan(50);
  expect(dug3d.maxAbs).toBeGreaterThan(0.2);
  expect((await appState(page)).gpuErrors).toEqual([]);
  expect(problems).toEqual([]);
});

test('idle play on the first level floods the village and loses in time', async ({ page }) => {
  test.setTimeout(180_000);
  const problems = watchConsole(page);
  await openApp(page, '?level=first-flood&view=2d');
  await page.keyboard.press('Enter');
  expect((await appState(page)).phase).toBe('running');

  let state = await appState(page);
  for (let guard = 0; guard < 40 && state.phase === 'running'; guard++) {
    await stepFrames(page, 10, 0.5);
    state = await appState(page);
  }
  expect(state.phase).toBe('lost');
  expect(state.durationSec).not.toBeNull();
  expect(state.elapsedSec).toBeLessThanOrEqual(state.durationSec!);
  expect(state.villages.every((v) => v.state === 'lost')).toBe(true);
  await expect(page.locator('.ls-result')).toBeVisible();
  await expect(page.locator('.ls-result .ls-modal-title')).toHaveText('Flooded!');
  await page.screenshot({ path: `${SCREENS_DIR}app-result.png` });
  expect(state.gpuErrors).toEqual([]);
  expect(problems).toEqual([]);
});

test('one quick swipe from the village to the sea saves the first level', async ({ page }) => {
  test.setTimeout(180_000);
  const problems = watchConsole(page);
  await openApp(page, '?level=first-flood&view=2d');
  await page.keyboard.press('Enter');
  await stepFrames(page, 6, 0.5); // the lake keeps rising for 3 s while the player finds the sea
  const box = await page.locator('canvas.ls-canvas').boundingBox();
  if (!box) throw new Error('canvas has no layout box');
  const grid = { width: 256, height: 192 };
  // Layout (u, v) -> client px, matching the level's cell mapping and the top-down shader.
  const toClient = (u: number, v: number) => ({
    x: box.x + ((u * (grid.width - 1) + 0.5) / grid.width) * box.width,
    y: box.y + ((v * (grid.height - 1) + 0.5) / grid.height) * box.height,
  });
  // The obvious human move: one fast (~48 cells/s) Dig swipe from the village straight east to the sea.
  const from = toClient(0.43, 0.73);
  const to = toClient(0.9, 0.73);
  const frames = Math.ceil(((0.9 - 0.43) * (grid.width - 1)) / 48 / 0.1);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= frames; i++) {
    const f = i / frames;
    await page.mouse.move(from.x + (to.x - from.x) * f, from.y + (to.y - from.y) * f);
    await stepFrames(page, 1, 0.1);
  }
  await page.mouse.up();

  let state = await appState(page);
  for (let guard = 0; guard < 40 && state.phase === 'running'; guard++) {
    await stepFrames(page, 10, 0.5);
    state = await appState(page);
  }
  expect(state.phase).toBe('won');
  expect(state.villages.every((v) => v.state !== 'lost')).toBe(true);
  await expect(page.locator('.ls-result .ls-modal-title')).toHaveText('Every village is safe!');
  await expect(page.locator('.ls-result .ls-star.is-lit')).toHaveCount(3);
  await expect(page.locator('.ls-result .ls-star-link')).toHaveAttribute('href', /github\.com/);
  await expect(page.locator('.ls-topbar .ls-github')).toHaveAttribute('href', /github\.com/);
  await page.screenshot({ path: `${SCREENS_DIR}app-won.png` });
  expect(state.gpuErrors).toEqual([]);
  expect(problems).toEqual([]);
});

test('switches between the 2D map and the 3D view with water on screen', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchConsole(page);
  await openApp(page, '?level=flash-flood&view=2d');
  await page.keyboard.press('Enter');
  await stepFrames(page, 12, 0.5);
  const water = await page.evaluate(async () => {
    const w = await window.__livesand!.debug.readWater();
    return w.reduce((sum, d) => sum + d, 0);
  });
  expect(water).toBeGreaterThan(1);
  await page.mouse.move(640, 430);
  await stepFrames(page, 1, 1 / 60);
  await page.screenshot({ path: `${SCREENS_DIR}app-2d.png` });

  await page.locator('.ls-segmented .ls-btn', { hasText: '3D' }).click();
  await expect.poll(async () => (await appState(page)).view).toBe('3d');
  expect(page.url()).toContain('view=3d');
  await stepFrames(page, 2, 1 / 60);
  await page.screenshot({ path: `${SCREENS_DIR}app-3d.png` });

  await page.keyboard.press('v');
  await expect.poll(async () => (await appState(page)).view).toBe('2d');
  await stepFrames(page, 1, 1 / 60);
  expect((await appState(page)).gpuErrors).toEqual([]);
  expect(problems).toEqual([]);
});

test('captures the briefing, menus and dialogs for visual review', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchConsole(page);
  await openApp(page, '?level=twin-towns');
  await stepFrames(page, 1, 1 / 60);
  await page.screenshot({ path: `${SCREENS_DIR}app-intro-3d.png` });

  await page.locator('.ls-level-button').click();
  await expect(page.locator('.ls-menu')).toBeVisible();
  await page.screenshot({ path: `${SCREENS_DIR}app-level-menu.png` });
  await page.keyboard.press('Escape');
  await expect(page.locator('.ls-menu')).toBeHidden();

  await page.keyboard.press('h');
  await expect(page.locator('.ls-help')).toBeVisible();
  await page.screenshot({ path: `${SCREENS_DIR}app-help.png` });
  await page.keyboard.press('Escape');
  await expect(page.locator('.ls-help')).toBeHidden();

  await page.locator('.ls-topbar .ls-btn-accent').click();
  await expect(page.locator('.ls-real')).toBeVisible();
  await page.screenshot({ path: `${SCREENS_DIR}app-real-sandbox.png` });
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page, '?level=first-flood&view=2d');
  await page.keyboard.press('Enter');
  await stepFrames(page, 20, 0.5);
  await page.screenshot({ path: `${SCREENS_DIR}app-mobile.png` });
  expect(problems).toEqual([]);
});

test('shows a friendly page when WebGPU is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true });
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__livesand?.error), null, { timeout: 30_000 });
  await expect(page.locator('.ls-fatal-title')).toContainText('can’t run LiveSand');
  await expect(page.locator('.ls-fatal-tips li')).not.toHaveCount(0);
  await expect(page.locator('.ls-fatal-preview img')).toHaveJSProperty('complete', true);
  expect(await page.locator('.ls-fatal-preview img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1200);
  await expect(page.locator('.ls-fatal .ls-btn-primary')).toHaveAttribute('href', /github\.com/);
  await page.screenshot({ path: `${SCREENS_DIR}app-no-webgpu.png` });
  expect(await page.evaluate(() => window.__livesand?.ready)).toBe(false);
});
