// Mount Ember in headless Chromium WebGPU: idle play loses the village to lava, a wall dragged with the mouse turns the
// flow into the sea (new land), the lava tool pours lava in free play and Reset clears it, plus a 3D screenshot.
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { APP_TEST_OPTIONS, SCREENS_DIR, appState, openApp, revealResult, stepFrames, watchConsole } from './app-e2e-test-helpers';
import { scaled } from './e2e-timing';

test.use(APP_TEST_OPTIONS);
test.beforeAll(() => mkdirSync(SCREENS_DIR, { recursive: true }));

interface VolcanoState {
  phase: string;
  elapsedSec: number;
  eruptionRate: number;
  lavaActive: boolean;
  tool: string;
  villages: { name: string; state: string; burnedSec: number; lostTo: string | null }[];
  gpuErrors: string[];
}

const volcanoState = (page: Page) => appState(page) as unknown as Promise<VolcanoState>;
const fieldSum = (page: Page, field: 'readLava' | 'readRock') =>
  page.evaluate(async (f) => (await window.__livesand!.debug[f]()).reduce((s, d) => s + d, 0), field);

/** Cells that were sea (below the painted sea level) in the initial terrain and now stand above it as rock or lava. */
async function newLandCells(page: Page, seaHeights: number[]): Promise<number> {
  return page.evaluate(async (sea) => {
    const [rock, lava] = await Promise.all([window.__livesand!.debug.readRock(), window.__livesand!.debug.readLava()]);
    const heights = window.__livesand!.debug.getHeights();
    return sea.filter((i) => heights[i] + rock[i] + lava[i] > 0.9).length;
  }, seaHeights);
}

/** Layout (u, v) -> client px on the 2D map, matching the level's cell mapping and the top-down shader. */
async function mapPoint(page: Page): Promise<(u: number, v: number) => { x: number; y: number }> {
  const box = await page.locator('canvas.ls-canvas').boundingBox();
  if (!box) throw new Error('canvas has no layout box');
  return (u, v) => ({ x: box.x + ((u * 255 + 0.5) / 256) * box.width, y: box.y + ((v * 191 + 0.5) / 192) * box.height });
}

test('idle play on Mount Ember burns Emberton down', async ({ page }) => {
  test.setTimeout(scaled(180_000));
  const problems = watchConsole(page);
  await openApp(page, '?level=mount-ember&view=2d');
  await expect(page.locator('.ls-intro .ls-card-title')).toHaveText('Mount Ember');
  await expect(page.locator('.ls-eruption')).toBeVisible();
  await expect(page.locator('.ls-tool[data-tool="lava"]')).toBeVisible();
  await page.keyboard.press('Enter');
  const seen = new Set<string>();
  let state = await volcanoState(page);
  for (let guard = 0; guard < 60 && state.phase === 'running'; guard++) {
    await stepFrames(page, 4, 0.5, false);
    state = await volcanoState(page);
    seen.add(state.villages[0].state);
  }
  await revealResult(page); // the result card waits for the aftermath; the last drawn frame refreshes the HUD
  expect(state.phase).toBe('lost');
  expect(state.elapsedSec).toBeLessThan(70);
  expect(state.villages[0]).toMatchObject({ state: 'lost', lostTo: 'lava' });
  expect(seen).toContain('burning');
  await expect(page.locator('.ls-result .ls-modal-title')).toHaveText('Burned!');
  await expect(page.locator('.ls-village')).toHaveClass(/is-lost/);
  await expect(page.locator('.ls-village-status')).toHaveText('Burned');
  expect(state.gpuErrors).toEqual([]);
  expect(problems).toEqual([]);
});

test('a wall dragged across the gully sends the lava into the sea and saves Emberton', async ({ page }) => {
  test.setTimeout(scaled(300_000));
  const problems = watchConsole(page);
  await openApp(page, '?level=mount-ember&view=2d');
  const sea = await page.evaluate(() => {
    const h = window.__livesand!.debug.getHeights();
    return Array.from(h.keys()).filter((i) => h[i] < 0.6);
  });
  await page.keyboard.press('Enter');
  await stepFrames(page, 6, 0.5, false); // the rumble: the player spots the gully and grabs the Raise tool
  await page.keyboard.press('1');
  const at = await mapPoint(page);
  // Back and forth three times across the gully (36 cells); strokes deposit per cell travelled, so a brisk drag
  // with four frames per pass builds the same wall as a slow one.
  const [from, to] = [at(0.23, 0.5), at(0.37, 0.5)];
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let pass = 0; pass < 3; pass++) {
    const [a, b] = pass % 2 === 0 ? [from, to] : [to, from];
    for (let i = 1; i <= 4; i++) {
      await page.mouse.move(a.x + ((b.x - a.x) * i) / 4, a.y + ((b.y - a.y) * i) / 4);
      await stepFrames(page, 1, 0.25, false);
    }
  }
  await page.mouse.up();

  let state = await volcanoState(page);
  for (let guard = 0; guard < 40 && state.phase === 'running' && state.elapsedSec < 62; guard++) {
    await stepFrames(page, 10, 0.5, false);
    state = await volcanoState(page);
  }
  expect(state.villages[0].state).toBe('safe');
  // Mid-eruption in 3D: the lava runs east down the old channel and piles up where it meets the sea.
  await page.keyboard.press('v');
  await stepFrames(page, 1, 1 / 30);
  await page.screenshot({ path: `${SCREENS_DIR}app-volcano-3d.png` });
  await page.keyboard.press('v'); // software WebGPU composites the full-window 3D canvas slowly: finish on the map
  for (let guard = 0; guard < 40 && state.phase === 'running'; guard++) {
    await stepFrames(page, 10, 0.5, false);
    state = await volcanoState(page);
  }
  await revealResult(page);
  expect(state.phase).toBe('won');
  expect(state.villages[0].burnedSec).toBe(0);
  expect(await newLandCells(page, sea)).toBeGreaterThan(20);
  await expect(page.locator('.ls-result .ls-modal-title')).toHaveText('Every village is safe!');
  expect(state.gpuErrors).toEqual([]);
  expect(problems).toEqual([]);
});

test('the lava tool pours flowing lava in free play, and Reset clears lava and rock', async ({ page }) => {
  test.setTimeout(scaled(120_000));
  const problems = watchConsole(page);
  await openApp(page, '?level=first-flood&view=2d');
  await expect(page.locator('.ls-tool[data-tool="lava"]')).toBeHidden();
  await page.keyboard.press('6');
  expect((await volcanoState(page)).tool).not.toBe('lava');

  await openApp(page, '?level=sandbox&view=2d');
  await page.locator('.ls-tool[data-tool="lava"]').click();
  expect((await volcanoState(page)).tool).toBe('lava');
  expect((await volcanoState(page)).lavaActive).toBe(false);
  const at = await mapPoint(page);
  const spot = at(0.3, 0.25); // high on the western hills of the river valley
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await stepFrames(page, 8, 0.25, false);
  await page.mouse.up();
  expect((await volcanoState(page)).lavaActive).toBe(true);
  const poured = await fieldSum(page, 'readLava');
  expect(poured).toBeGreaterThan(5);
  await stepFrames(page, 20, 0.5);
  expect(await fieldSum(page, 'readRock')).toBeGreaterThan(0.5);
  await page.screenshot({ path: `${SCREENS_DIR}app-lava-free-play.png` });

  await page.keyboard.press('r');
  await stepFrames(page, 2, 1 / 30);
  expect(await fieldSum(page, 'readLava')).toBe(0);
  expect(await fieldSum(page, 'readRock')).toBe(0);
  expect((await volcanoState(page)).lavaActive).toBe(false);
  expect((await volcanoState(page)).gpuErrors).toEqual([]);
  expect(problems).toEqual([]);
});
