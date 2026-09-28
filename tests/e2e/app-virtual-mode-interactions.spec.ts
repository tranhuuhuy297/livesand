// Virtual-mode interaction details: touch gestures, dialogs holding the game, keyboard safety, focus handling,
// free play extras, the storm overlay and the quarter-turned portrait map.
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { APP_TEST_OPTIONS, SCREENS_DIR, appState, heightsDelta, openApp, stepFrames } from './app-e2e-test-helpers';
import { touchPointer, waterSum, watchConsole } from './app-e2e-test-helpers';
import { scaled } from './e2e-timing';

test.use(APP_TEST_OPTIONS);
test.beforeAll(() => mkdirSync(SCREENS_DIR, { recursive: true }));

test('a two-finger touch orbit neither starts the level nor digs; one finger digs once it moves', async ({ page }) => {
  const problems = watchConsole(page);
  // 2D: pinching there used to dig as well, and the map draws fast enough for many small scripted steps.
  await openApp(page, '?level=first-flood&view=2d');
  const pinch = await heightsDelta(page, async () => {
    await touchPointer(page, 'pointerdown', 1, 600, 470);
    await stepFrames(page, 2, 1 / 60); // the second finger lands a few frames later
    await touchPointer(page, 'pointerdown', 2, 720, 500);
    for (let i = 1; i <= 6; i++) {
      await touchPointer(page, 'pointermove', 1, 600 - i * 8, 470 + i * 4);
      await touchPointer(page, 'pointermove', 2, 720 + i * 8, 500 - i * 4);
      await stepFrames(page, 1, 1 / 30);
    }
    await touchPointer(page, 'pointerup', 2, 768, 476);
    await stepFrames(page, 2, 1 / 30); // the remaining finger must not start painting
    await touchPointer(page, 'pointerup', 1, 552, 494);
    await stepFrames(page, 2, 1 / 30);
  });
  expect(pinch.changed).toBe(0);
  expect((await appState(page)).phase).toBe('ready');

  const dig = await heightsDelta(page, async () => {
    await touchPointer(page, 'pointerdown', 3, 600, 470);
    for (let i = 1; i <= 8; i++) {
      await touchPointer(page, 'pointermove', 3, 600 + i * 4, 470 + i * 2);
      await stepFrames(page, 1, 1 / 30);
    }
    await touchPointer(page, 'pointerup', 3, 632, 486);
  });
  expect(dig.changed).toBeGreaterThan(20);
  expect((await appState(page)).phase).toBe('running');
  expect(problems).toEqual([]);
});

test('help and the real-sandbox dialog hold the clock and the water; Enter behind them does not start the level', async ({ page }) => {
  const problems = watchConsole(page);
  await openApp(page, '?level=first-flood&view=2d');
  await page.keyboard.press('h');
  await expect(page.locator('.ls-help')).toBeVisible();
  await page.locator('.ls-help .ls-modal-lead').click();
  await page.keyboard.press('Enter');
  expect((await appState(page)).phase).toBe('ready');
  await page.keyboard.press('Escape');

  await page.keyboard.press('Enter');
  await stepFrames(page, 4, 0.5);
  for (const open of [() => page.keyboard.press('h'), () => page.locator('.ls-topbar .ls-btn-accent').click()]) {
    await open();
    await expect(page.locator('.ls-timer')).toHaveClass(/is-paused/);
    const before = { t: (await appState(page)).elapsedSec, water: await waterSum(page) };
    await stepFrames(page, 20, 0.5);
    expect((await appState(page)).elapsedSec).toBe(before.t);
    expect(await waterSum(page)).toBeCloseTo(before.water, 3);
    await page.keyboard.press('Escape');
  }
  const t = (await appState(page)).elapsedSec;
  await stepFrames(page, 4, 0.5);
  expect((await appState(page)).elapsedSec).toBeGreaterThan(t + 1.5);
  expect(problems).toEqual([]);
});

test('holding Space to orbit when a level is lost does not click the focused Retry on release', async ({ page }) => {
  test.setTimeout(scaled(120_000));
  await openApp(page, '?level=first-flood&view=3d');
  await page.keyboard.press('Enter');
  await page.keyboard.down(' ');
  let state = await appState(page);
  for (let guard = 0; guard < 40 && state.phase === 'running'; guard++) {
    await stepFrames(page, 10, 0.5);
    state = await appState(page);
  }
  expect(state.phase).toBe('lost');
  await expect(page.locator('.ls-result')).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toContain('Retry');
  await page.keyboard.down(' '); // auto-repeat lands on the freshly focused button
  await page.keyboard.up(' ');
  await stepFrames(page, 1, 1 / 60);
  expect((await appState(page)).phase).toBe('lost');
  await expect(page.locator('.ls-result')).toBeVisible();
});

test('keyboard focus: the slider keeps it, Esc returns to the level picker, Tab stays inside dialogs', async ({ page }) => {
  await openApp(page, '?level=first-flood&view=2d');
  await page.locator('input.ls-range').focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => document.activeElement?.classList.contains('ls-range'))).toBe(true);
  await expect.poll(async () => (await appState(page) as unknown as { brushRadius: number }).brushRadius).toBe(11);

  await page.locator('.ls-level-button').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.ls-menu')).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.classList.contains('ls-menu-item'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.ls-menu')).toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.classList.contains('ls-level-button'))).toBe(true);

  await page.keyboard.press('h');
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.ls-help')))).toBe(true);
  }
});

test('the first frame already shows the river running, with the briefing beside the box', async ({ page }) => {
  await openApp(page, '?level=first-flood&view=3d');
  expect((await appState(page)).phase).toBe('ready');
  const water = await waterSum(page);
  expect(water).toBeGreaterThan(50);
  const card = await page.locator('.ls-intro').boundingBox();
  expect(card!.x + card!.width).toBeLessThan(360);
  // Frozen until the player starts: the lake does not rise while they read.
  await stepFrames(page, 10, 0.5);
  expect(await waterSum(page)).toBeCloseTo(water, 3);
});

test('free play: living landscape, new terrain and a rain toggle instead of a clock', async ({ page }) => {
  const problems = watchConsole(page);
  await openApp(page, '?level=first-flood&view=3d');
  await page.locator('.ls-level-button').click();
  await page.locator('.ls-menu-item', { hasText: 'Free play' }).click();
  await expect(page.locator('.ls-timer')).toBeHidden();
  await expect(page.locator('.ls-free-actions')).toBeVisible();
  expect(await waterSum(page)).toBeGreaterThan(20);
  const reshaped = await heightsDelta(page, () => page.locator('.ls-free-terrain').click());
  expect(reshaped.changed).toBeGreaterThan(5000);
  await page.locator('.ls-free-rain').click();
  await expect(page.locator('.ls-free-rain')).toHaveAttribute('aria-pressed', 'true');
  await stepFrames(page, 20, 0.25);
  await expect(page.locator('.ls-storm-fx')).toBeVisible();
  await page.screenshot({ path: `${SCREENS_DIR}app-free-play-rain.png` });
  expect(problems).toEqual([]);
});

test('the storm is visible: rain overlay over the canvas while the Flash Flood storm peaks', async ({ page }) => {
  test.setTimeout(scaled(120_000));
  await openApp(page, '?level=flash-flood&view=3d');
  await expect(page.locator('.ls-storm-fx')).toBeHidden();
  await page.keyboard.press('Enter');
  await stepFrames(page, 70, 0.5);
  await expect(page.locator('.ls-storm-fx')).toBeVisible();
  const storm = await page.locator('.ls-storm-fx').evaluate((el) => Number(getComputedStyle(el).getPropertyValue('--storm')));
  expect(storm).toBeGreaterThan(0.8);
  await page.screenshot({ path: `${SCREENS_DIR}app-storm-3d.png` });
});

test('portrait phones get the quarter-turned map and sculpting lands under the finger', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page, '?level=sandbox&view=2d');
  const box = (await page.locator('canvas.ls-canvas').boundingBox())!;
  expect(box.height).toBeGreaterThan(box.width);
  const at = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.25 };
  // Quarter-turned map: screen down is east (grid x), screen left is south (grid y).
  const expected = { x: 0.25 * 256 - 0.5, y: (1 - 0.3) * 192 - 0.5 };
  await page.evaluate(() => {
    (window as unknown as { __before: Float32Array }).__before = window.__livesand!.debug.getHeights();
  });
  await page.keyboard.press('1');
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await stepFrames(page, 8, 1 / 30);
  await page.mouse.up();
  const peak = await page.evaluate(() => {
    const before = (window as unknown as { __before: Float32Array }).__before;
    const after = window.__livesand!.debug.getHeights();
    let best = 0;
    let at = 0;
    for (let i = 0; i < after.length; i++) {
      if (after[i] - before[i] > best) [best, at] = [after[i] - before[i], i];
    }
    return { x: at % 256, y: Math.floor(at / 256), rise: best };
  });
  expect(peak.rise).toBeGreaterThan(0.5);
  expect(Math.abs(peak.x - expected.x)).toBeLessThan(3);
  expect(Math.abs(peak.y - expected.y)).toBeLessThan(3);
  await page.screenshot({ path: `${SCREENS_DIR}app-mobile-2d-portrait.png` });
  await openApp(page, '?level=first-flood&view=3d');
  await page.keyboard.press('Enter');
  await stepFrames(page, 6, 0.5);
  await page.screenshot({ path: `${SCREENS_DIR}app-mobile-3d-portrait.png` });
});
