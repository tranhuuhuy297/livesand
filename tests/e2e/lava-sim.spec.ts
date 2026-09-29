// Headless-Chromium WebGPU checks of the lava simulation (flow, cooling into rock, water quench) via the harness page.
import { expect, test, type Page } from '@playwright/test';
import type { LavaSimHarnessApi } from '../gpu-harness/lava-sim-harness-api';
import { scaled } from './e2e-timing';

const HARNESS_URL = '/tests/gpu-harness/lava-sim-harness.html';

type ScenarioName = Exclude<keyof LavaSimHarnessApi, 'uncapturedErrors'>;
type ScenarioResult<K extends ScenarioName> = Awaited<ReturnType<LavaSimHarnessApi[K]>>;

const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(HARNESS_URL);
  await page.waitForFunction(() => window.__lavaSimHarness !== undefined || window.__lavaSimHarnessError !== undefined, null, {
    timeout: scaled(20_000),
  });
  const bootError = await page.evaluate(() => window.__lavaSimHarnessError ?? null);
  expect(bootError, 'WebGPU harness failed to boot').toBeNull();
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? [], 'uncaught page errors').toEqual([]);
});

async function run<K extends ScenarioName>(page: Page, name: K): Promise<ScenarioResult<K>> {
  const result = (await page.evaluate<unknown, ScenarioName>((n) => window.__lavaSimHarness![n](), name)) as ScenarioResult<K>;
  expect(result.errors, `GPU errors during ${name}`).toEqual([]);
  return result;
}

test('lava flows downhill but advances much slower than water on the same slope', async ({ page }) => {
  const r = await run(page, 'slope');
  expect(r.lavaFrontAfter).toBeGreaterThan(r.lavaFrontBefore + 3);
  expect(r.lavaCentroidAfter).toBeGreaterThan(r.lavaCentroidBefore + 0.5);
  expect(r.waterFrontAfter).toBeGreaterThan(r.lavaFrontAfter + 10);
  expect(r.lavaCentroidAfter - r.lavaCentroidBefore).toBeLessThan((r.waterCentroidAfter - r.waterCentroidBefore) / 3);
  expect(r.relMaterialError).toBeLessThan(0.01);
});

test('walls conserve lava + rock within 1% while cooling moves lava into rock', async ({ page }) => {
  const r = await run(page, 'conservation');
  expect(r.initial).toBeGreaterThan(0);
  expect(r.relError).toBeLessThan(0.01);
  expect(r.rockFinal).toBeGreaterThan(0);
  expect(r.lavaFinal).toBeGreaterThan(0);
  expect(r.minLava).toBeGreaterThanOrEqual(0);
  expect(r.nanCount).toBe(0);
});

test('cooling freezes a stalled pile into rock and the water terrain is exactly base + rock + lava', async ({ page }) => {
  const r = await run(page, 'cooling');
  expect(r.finalLava).toBeLessThan(r.initialLava * 0.01);
  expect(Math.abs(r.finalRock + r.finalLava - r.initialLava) / r.initialLava).toBeLessThan(0.01);
  // Stops on the flat as it stiffens and cools instead of spreading to the walls like water would.
  expect(r.extentRadius).toBeLessThan(r.wallDistance - 3);
  expect(r.terrainRiseAtCentre).toBeGreaterThan(0.5);
  expect(r.terrainMaxAbsDiff).toBeLessThanOrEqual(1e-6);
  expect(r.zeroStepMaxAbsDiff).toBeLessThanOrEqual(1e-6);
});

test('a base-terrain wall dams a continuous crater flow', async ({ page }) => {
  const r = await run(page, 'dam');
  expect(r.relError).toBeLessThan(0.01);
  // The flow really reached the wall and piled up against it, yet nothing got past.
  expect(r.materialFrontX).toBeGreaterThanOrEqual(r.wallX - 2);
  expect(r.materialNearWall).toBeGreaterThan(r.emitted * 0.05);
  expect(r.downstreamMaterial).toBeLessThan(1e-3);
});

test('lava reaching a lake quenches into rock and boils water off', async ({ page }) => {
  const r = await run(page, 'quench');
  expect(Math.abs(r.controlWaterFinal - r.waterInitial) / r.waterInitial).toBeLessThan(0.005);
  expect(r.waterFinal).toBeLessThan(r.controlWaterFinal * 0.95);
  expect(r.rockInPool).toBeGreaterThan(10);
  expect(r.poolSolidFraction).toBeGreaterThan(0.6);
  expect(r.poolSolidFraction).toBeGreaterThan(r.noQuenchPoolSolidFraction + 0.2);
});

test('deep lava dam break and tower stay stable (no NaN, bounded depth, conserved)', async ({ page }) => {
  const r = await run(page, 'stability');
  expect(r.nanCount).toBe(0);
  expect(r.minLava).toBeGreaterThanOrEqual(0);
  expect(r.maxLavaSeen).toBeLessThanOrEqual(r.initialMax * 1.05);
  expect(r.relMassError).toBeLessThan(0.005);
});

test('invalid inputs throw RangeError, bad values are sanitised, clear() and destroy() behave', async ({ page }) => {
  const r = await run(page, 'inputValidation');
  expect(r.rangeErrorsThrown).toBe(r.rangeErrorsExpected);
  expect(r.sanitizedNaN).toBe(0);
  expect(r.sanitizedNegative).toBe(0);
  expect(r.clearedLava).toBe(0);
  expect(r.clearedRock).toBe(0);
  expect(r.terrainAfterClearMaxAbsDiff).toBe(0);
  expect(r.destroyedThrows).toBe(true);
});

test('all lava scenarios together raise no GPU validation errors', async ({ page }) => {
  const names: ScenarioName[] = ['inputValidation', 'slope', 'conservation', 'cooling', 'dam', 'quench', 'stability'];
  for (const name of names) await run(page, name);
  const uncaptured = await page.evaluate(() => window.__lavaSimHarness!.uncapturedErrors());
  expect(uncaptured).toEqual([]);
});
