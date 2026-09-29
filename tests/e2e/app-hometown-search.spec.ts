// "Your hometown" in headless Chromium WebGPU with no network: a place-name search and "Use my location" (mocked Photon
// geocoder, geolocation and terrain tiles) load a named, shareable map; a late location fix after closing does nothing.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { latToGlobalPixelY, lonToGlobalPixelX, placeMercatorBox } from '../../src/game/place-terrain-resampling';
import { TERRARIUM_TILE_SIZE as S, encodeTerrariumMeters } from '../../src/game/terrarium-decoding';
import { APP_TEST_OPTIONS, SCREENS_DIR, appState, openApp, stepFrames, watchConsole } from './app-e2e-test-helpers';
import { scaled } from './e2e-timing';

test.use(APP_TEST_OPTIONS);
test.beforeAll(() => mkdirSync(SCREENS_DIR, { recursive: true }));

// pngjs ships without type declarations; this is the slice of its API the test uses.
interface PngImage { data: Uint8Array }
const { PNG } = createRequire(import.meta.url)('pngjs') as { PNG: { new (o: { width: number; height: number }): PngImage; sync: { write(p: PngImage): Buffer } } };

interface PlaceState { level: string; levelName: string; loading: string | null; seaLevel: number; place: { name: string; attribution: string } | null; gpuErrors: string[] }
const placeState = (page: Page) => appState(page) as unknown as Promise<PlaceState>;
const AT = { lat: 16.05, lon: 108.2 };
const feature = (name: string, extra: Record<string, unknown> = {}) => ({
  type: 'Feature', geometry: { type: 'Point', coordinates: [AT.lon, AT.lat] }, properties: { name, country: 'Việt Nam', ...extra },
});

/** Mocks terrain tiles (a volcanic island in a 0 m sea around AT), the Photon geocoder and a delayable geolocation. */
async function mockWorld(page: Page): Promise<string[]> {
  const tiles: string[] = [];
  await page.route(/^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png$/, async (route) => {
    const [z, tx, ty] = new URL(route.request().url()).pathname.match(/(\d+)\/(\d+)\/(\d+)\.png$/)!.slice(1).map(Number);
    tiles.push(`${z}/${tx}/${ty}`);
    const box = placeMercatorBox({ ...AT, widthKm: 20 }, { width: 256, height: 192 }, z);
    const [cx, cy] = [lonToGlobalPixelX(AT.lon, z), latToGlobalPixelY(AT.lat, z)];
    const png = new PNG({ width: S, height: S });
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const r = Math.hypot(tx * S + x - cx, ty * S + y - cy) / box.width;
        png.data.set([...encodeTerrariumMeters(1500 * Math.max(0, 1 - 2.4 * r)), 255], (y * S + x) * 4);
      }
    }
    await route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG.sync.write(png) });
  });
  await page.route(/^https:\/\/photon\.komoot\.io\/(api|reverse)/, async (route) => {
    const url = new URL(route.request().url());
    const q = url.searchParams.get('q') ?? '';
    const features = url.pathname.startsWith('/reverse')
      ? [feature('Cửa hàng', { type: 'house', district: 'Hải Châu', city: 'Đà Nẵng' })]
      : /nowhere/i.test(q) ? [] : [feature('Đà Nẵng', { type: 'city', state: 'Đà Nẵng' }), feature('Đà Nẵng Beach', { city: 'Đà Nẵng' })];
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ type: 'FeatureCollection', features }) });
  });
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: AT.lat, longitude: AT.lon });
  // Lets a test hold the location fix back, like a slow GPS or a pending permission prompt.
  await page.addInitScript(() => {
    const geo = navigator.geolocation;
    const original = geo.getCurrentPosition.bind(geo);
    geo.getCurrentPosition = (ok, err, opts) => original((pos) => setTimeout(() => ok(pos), (window as unknown as { __geoDelayMs?: number }).__geoDelayMs ?? 0), err, opts);
  });
  return tiles;
}

async function openHometownDialog(page: Page): Promise<void> {
  await page.locator('.ls-level-button').click();
  const item = page.locator('.ls-place-item[data-place="place-custom"]');
  await expect(item).toContainText('Your hometown…');
  await item.click();
  await expect(page.locator('.ls-any-place')).toBeVisible();
}

test('a town found by name loads as a named map whose link carries the name', async ({ page }) => {
  test.setTimeout(scaled(120_000));
  const problems = watchConsole(page);
  const tiles = await mockWorld(page);
  await openApp(page, '?level=sandbox&view=2d');
  await openHometownDialog(page);
  await expect(page.locator('.ls-place-locate')).toHaveClass(/ls-btn-primary/);
  await page.locator('.ls-any-place .ls-text-input').fill('nowhere at all');
  await page.keyboard.press('Enter');
  await expect(page.locator('.ls-place-error')).toContainText('No places found');
  await page.locator('.ls-any-place .ls-text-input').fill('Da Nang');
  await page.locator('.ls-place-search').click();
  await expect(page.locator('.ls-place-result')).toHaveCount(2);
  await expect(page.locator('.ls-place-result').first()).toContainText('Đà Nẵng');
  await page.screenshot({ path: `${SCREENS_DIR}app-hometown-search.png` });
  await page.locator('.ls-place-result').first().click();
  await expect(page.locator('.ls-any-place')).toBeHidden();
  await expect.poll(async () => { const s = await placeState(page); return s.loading === null ? s.level : 'loading'; }, { timeout: scaled(30_000) }).toBe('place-custom');
  const s = await placeState(page);
  expect(tiles.length).toBeGreaterThan(0);
  expect(s).toMatchObject({ levelName: 'Đà Nẵng', seaLevel: 2, place: { name: 'Đà Nẵng' } });
  const url = new URL(page.url());
  expect(url.searchParams.get('place')).toBe(`${AT.lat},${AT.lon},20`);
  expect(url.searchParams.get('name')).toBe('Đà Nẵng');
  const heights = await page.evaluate(() => window.__livesand!.debug.getHeights());
  const peak = heights.indexOf(Math.max(...heights));
  expect(Math.abs((peak % 256) - 127.5)).toBeLessThan(6);
  expect(Math.abs(Math.floor(peak / 256) - 95.5)).toBeLessThan(6);
  await stepFrames(page, 1, 1 / 60);
  await expect(page.locator('.ls-level-name')).toHaveText('Đà Nẵng');
  await expect(page.locator('.ls-place-card .ls-place-flood')).toBeVisible();
  await page.screenshot({ path: `${SCREENS_DIR}app-hometown-loaded.png` });

  // The shared link reopens the same named map.
  await openApp(page, url.search);
  expect((await placeState(page)).levelName).toBe('Đà Nẵng');
  expect(s.gpuErrors).toEqual([]);
  expect(problems).toEqual([]);
});

test('"Use my location" names the map by reverse geocoding; a fix arriving after the dialog closed is ignored', async ({ page }) => {
  test.setTimeout(scaled(120_000));
  const problems = watchConsole(page);
  const tiles = await mockWorld(page);
  await openApp(page, '?level=sandbox&view=2d');
  await openHometownDialog(page);
  await page.evaluate(() => ((window as unknown as { __geoDelayMs: number }).__geoDelayMs = 1500));
  await page.locator('.ls-place-locate').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ls-any-place')).toBeHidden();
  await page.waitForTimeout(2500);
  expect(tiles).toEqual([]);
  expect((await placeState(page)).level).toBe('sandbox');

  await page.evaluate(() => ((window as unknown as { __geoDelayMs: number }).__geoDelayMs = 0));
  await openHometownDialog(page);
  await page.locator('.ls-place-locate').click();
  await expect.poll(async () => { const s = await placeState(page); return s.loading === null ? s.level : 'loading'; }, { timeout: scaled(30_000) }).toBe('place-custom');
  expect((await placeState(page)).levelName).toBe('Đà Nẵng');
  expect(new URL(page.url()).searchParams.get('name')).toBe('Đà Nẵng');
  expect((await placeState(page)).gpuErrors).toEqual([]);
  expect(problems).toEqual([]);
});
