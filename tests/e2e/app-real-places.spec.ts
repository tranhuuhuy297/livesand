// Real places in headless Chromium WebGPU: every baked map loads from the level menu (with its place card), ?place=
// links with Share and the "Flood it" storm, and the Hội An flood level lost idle and won.
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { REAL_PLACES } from '../../src/game/real-places-catalog';
import { APP_TEST_OPTIONS, SCREENS_DIR, appState, openApp, revealResult, stepFrames, watchConsole } from './app-e2e-test-helpers';
import { scaled } from './e2e-timing';

test.use(APP_TEST_OPTIONS);
test.beforeAll(() => mkdirSync(SCREENS_DIR, { recursive: true }));

interface PlaceState {
  level: string;
  levelName: string;
  phase: string;
  elapsedSec: number;
  loading: string | null;
  place: { name: string; attribution: string; link: unknown } | null;
  seaLevel: number;
  openEdges: Record<string, boolean>;
  lavaTool: boolean;
  villages: { state: string; lostTo: string | null }[];
  gpuErrors: string[];
}
const placeState = (page: Page) => appState(page) as unknown as Promise<PlaceState>;
const loaded = async (page: Page, level: string) =>
  expect.poll(async () => { const s = await placeState(page); return s.loading === null ? s.level : 'loading'; }, { timeout: scaled(30_000) }).toBe(level);

test('every baked real place loads from the level menu without errors', async ({ page }) => {
  test.setTimeout(scaled(180_000));
  const problems = watchConsole(page);
  await openApp(page, '?level=sandbox&view=2d');
  let before = await page.evaluate(() => window.__livesand!.debug.getHeights());
  for (const place of REAL_PLACES) {
    await page.locator('.ls-level-button').click();
    const item = page.locator(`.ls-place-item[data-place="place-${place.id}"]`);
    await expect(item).toContainText(place.nameVi ?? place.name);
    await item.click();
    await loaded(page, `place-${place.id}`);
    await stepFrames(page, 2, 0.25, false);
    const s = await placeState(page);
    expect(s.levelName).toBe(place.nameVi ?? place.name);
    expect(s.place?.attribution).toMatch(/Mapzen/);
    expect(s.lavaTool).toBe(true);
    const heights = await page.evaluate(() => window.__livesand!.debug.getHeights());
    expect(heights.some((h, i) => Math.abs(h - before[i]) > 0.5)).toBe(true);
    before = heights;
    expect(page.url()).toContain(`place=${place.id}`);
    expect(s.gpuErrors).toEqual([]);
    if (place.id === 'hoi-an') {
      await stepFrames(page, 1, 1 / 60);
      await expect(page.locator('.ls-place-challenge')).toHaveText('Play Hội An Floods');
    }
  }
  await stepFrames(page, 1, 1 / 60);
  await expect(page.locator('.ls-level-name')).toHaveText('Mount St. Helens');
  await expect(page.locator('.ls-credit')).toBeVisible();
  await expect(page.locator('.ls-credit')).toContainText('Elevation');
  // Touch screens never see the menu's tooltips: the place card tells what the map is.
  await expect(page.locator('.ls-place-card .ls-card-title')).toHaveText('Mount St. Helens');
  await expect(page.locator('.ls-place-card')).toContainText('horseshoe crater');
  await expect(page.locator('.ls-place-challenge')).toBeHidden();
  expect(problems).toEqual([]);
});

test('a ?place= link opens Ha Long Bay as free play with rain, lava and Share, and "Flood it" storms the town', async ({ page }) => {
  test.setTimeout(scaled(180_000));
  const problems = watchConsole(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await openApp(page, '?place=ha-long-bay&view=3d');
  const s = await placeState(page);
  expect(s.level).toBe('place-ha-long-bay');
  expect(s.seaLevel).toBe(2);
  expect(Object.values(s.openEdges).some(Boolean)).toBe(true);
  await stepFrames(page, 1, 1 / 30);
  await expect(page.locator('.ls-level-name')).toHaveText('Vịnh Hạ Long');
  await expect(page.locator('.ls-free-rain')).toBeVisible();
  // A random landscape would silently throw the real map away, so real maps offer Share in its place.
  await expect(page.locator('.ls-free-terrain')).toBeHidden();
  await expect(page.locator('.ls-free-share')).toHaveText('Share');
  await expect(page.locator('.ls-tool[data-tool="lava"]')).toBeVisible();
  await expect(page.locator('.ls-credit')).toContainText('Mapzen');
  await expect(page.locator('.ls-place-card')).toContainText('karst islands');
  await page.screenshot({ path: `${SCREENS_DIR}app-place-ha-long.png` });
  await page.keyboard.press('v'); // software WebGPU composites the full-window 3D canvas slowly: go on in 2D
  expect(page.url()).toContain('place=ha-long-bay');
  expect(page.url()).not.toContain('level=');
  await page.locator('.ls-free-share').click();
  await expect(page.locator('.ls-toast')).toHaveText('Link copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('place=ha-long-bay');

  // "Flood it": a storm with the town pinned near the centre, on the same map (no second download).
  await page.locator('.ls-place-flood').click();
  let storm = await placeState(page);
  expect(storm).toMatchObject({ level: 'place-ha-long-bay-storm', phase: 'ready', villages: [{ state: 'safe' }] });
  await stepFrames(page, 1, 1 / 30);
  await expect(page.locator('.ls-intro .ls-card-title')).toHaveText('Storm over Vịnh Hạ Long');
  await expect(page.locator('.ls-place-card')).toBeHidden();
  expect(page.url()).toContain('place=ha-long-bay');
  await page.keyboard.press('Enter');
  for (let guard = 0; guard < 40 && storm.phase !== 'won' && storm.phase !== 'lost'; guard++) {
    await stepFrames(page, 10, 0.5, false);
    storm = await placeState(page);
  }
  expect(['won', 'lost']).toContain(storm.phase);
  await revealResult(page);
  await page.locator('.ls-result').getByRole('button', { name: 'Free play' }).click();
  expect((await placeState(page)).level).toBe('place-ha-long-bay');
  expect(s.gpuErrors).toEqual([]);
  expect((await placeState(page)).gpuErrors).toEqual([]);
  expect(problems).toEqual([]);
});

async function playHoiAn(page: Page, levee: boolean): Promise<PlaceState> {
  await openApp(page, '?level=hoi-an-floods&view=2d');
  await expect(page.locator('.ls-intro .ls-card-title')).toHaveText('Hội An Floods');
  // The briefing says to build, so the level starts with Raise and marks where the levee goes.
  expect((await appState(page)).tool).toBe('raise');
  await expect(page.locator('.ls-intro .ls-muted')).toHaveText('or just start building');
  await expect(page.locator('.ls-level-hint')).toBeVisible();
  await page.keyboard.press('Enter');
  if (levee) {
    await stepFrames(page, 6, 0.5, false);
    await page.keyboard.press('1');
    const box = (await page.locator('canvas.ls-canvas').boundingBox())!;
    const at = (u: number, v: number) => ({ x: box.x + ((u * 255 + 0.5) / 256) * box.width, y: box.y + ((v * 191 + 0.5) / 192) * box.height });
    // Two passes along the north bank of the river, just south of the Old Town.
    const [from, to] = [at(0.24, 0.57), at(0.42, 0.57)];
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (const [a, b] of [[from, to], [to, from]]) {
      for (let i = 1; i <= 4; i++) {
        await page.mouse.move(a.x + ((b.x - a.x) * i) / 4, a.y + ((b.y - a.y) * i) / 4);
        await stepFrames(page, 1, 0.25, false);
      }
    }
    await page.mouse.up();
  }
  let s = await placeState(page);
  for (let guard = 0; guard < 40 && s.phase === 'running'; guard++) {
    await stepFrames(page, 10, 0.5, false);
    s = await placeState(page);
    if (!levee && s.elapsedSec >= 40 && s.elapsedSec < 45) {
      await stepFrames(page, 1, 1 / 60);
      await page.screenshot({ path: `${SCREENS_DIR}app-place-hoi-an.png` });
    }
  }
  await revealResult(page);
  return s;
}

test('Hội An Floods: idle play floods the Old Town, a levee along the river saves it', async ({ page }) => {
  test.setTimeout(scaled(300_000));
  const problems = watchConsole(page);
  const idle = await playHoiAn(page, false);
  expect(idle.phase).toBe('lost');
  expect(idle.elapsedSec).toBeLessThan(72);
  expect(idle.villages[0]).toMatchObject({ state: 'lost', lostTo: 'flood' });
  await expect(page.locator('.ls-result .ls-modal-title')).toHaveText('Flooded!');
  const won = await playHoiAn(page, true);
  expect(won.phase).toBe('won');
  await expect(page.locator('.ls-result .ls-modal-title')).toHaveText('Every village is safe!');
  expect(won.gpuErrors).toEqual([]);
  expect(problems).toEqual([]);
});
