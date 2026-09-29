// Phones in portrait (390 x 844): made-up levels turn the 2D map a quarter with a north arrow, real maps stay north-up
// in 2D and 3D so locals recognise them, and the level menu stays on screen.
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { APP_TEST_OPTIONS, SCREENS_DIR, appState, openApp, stepFrames, watchConsole } from './app-e2e-test-helpers';
import { scaled } from './e2e-timing';

test.use({ ...APP_TEST_OPTIONS, viewport: { width: 390, height: 844 }, hasTouch: true });
test.beforeAll(() => mkdirSync(SCREENS_DIR, { recursive: true }));

interface LayoutState { level: string; loading: string | null; mapTurned: boolean; camera: { yaw: number } }
const layoutState = (page: Page) => appState(page) as unknown as Promise<LayoutState>;
const canvasBox = async (page: Page) => (await page.locator('canvas.ls-canvas').boundingBox())!;

test('made-up levels turn the 2D map with a north arrow; real maps stay north-up in 2D and 3D', async ({ page }) => {
  test.setTimeout(scaled(120_000));
  const problems = watchConsole(page);
  await openApp(page, '?level=mount-ember&view=2d');
  await stepFrames(page, 1, 1 / 30);
  expect((await layoutState(page)).mapTurned).toBe(true);
  let box = await canvasBox(page);
  expect(box.height).toBeGreaterThan(box.width);
  await expect(page.locator('.ls-compass')).toBeVisible();
  await expect(page.locator('.ls-level-hint')).toBeVisible();
  await page.screenshot({ path: `${SCREENS_DIR}app-phone-ember-intro.png` });

  await openApp(page, '?place=hue&view=2d');
  await stepFrames(page, 1, 1 / 30);
  expect((await layoutState(page)).mapTurned).toBe(false);
  box = await canvasBox(page);
  expect(box.width).toBeGreaterThan(box.height);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await expect(page.locator('.ls-compass')).toBeHidden();
  await page.screenshot({ path: `${SCREENS_DIR}app-phone-hue-2d.png` });

  await openApp(page, '?place=hue&view=3d');
  expect(Math.abs((await layoutState(page)).camera.yaw)).toBeLessThan(1e-6);
  await openApp(page, '?level=first-flood&view=3d');
  expect((await layoutState(page)).camera.yaw).toBeCloseTo(Math.PI / 2 + 0.12, 5);
  expect(problems).toEqual([]);
});

test('the level menu fits a phone screen', async ({ page }) => {
  await openApp(page, '?level=first-flood&view=2d');
  await page.locator('.ls-level-button').click();
  const menu = (await page.locator('.ls-menu').boundingBox())!;
  expect(menu.x).toBeGreaterThanOrEqual(0);
  expect(menu.x + menu.width).toBeLessThanOrEqual(390);
  await expect(page.locator('.ls-place-item[data-place="place-custom"]')).toContainText('Your hometown');
  await page.screenshot({ path: `${SCREENS_DIR}app-phone-menu.png` });
});
