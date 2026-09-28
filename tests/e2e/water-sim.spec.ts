// Headless-Chromium WebGPU checks of the water simulation and village probes via the harness page.
import { expect, test, type Page } from '@playwright/test';
import type { WaterSimHarnessApi } from '../gpu-harness/water-sim-harness-api';

const HARNESS_URL = '/tests/gpu-harness/water-sim-harness.html';

type ScenarioName = Exclude<keyof WaterSimHarnessApi, 'uncapturedErrors'>;
type ScenarioResult<K extends ScenarioName> = Awaited<ReturnType<WaterSimHarnessApi[K]>>;

const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(HARNESS_URL);
  await page.waitForFunction(() => window.__waterSimHarness !== undefined || window.__waterSimHarnessError !== undefined);
  const bootError = await page.evaluate(() => window.__waterSimHarnessError ?? null);
  expect(bootError, 'WebGPU harness failed to boot').toBeNull();
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? [], 'uncaught page errors').toEqual([]);
});

async function run<K extends ScenarioName>(page: Page, name: K): Promise<ScenarioResult<K>> {
  const result = (await page.evaluate<unknown, ScenarioName>((n) => window.__waterSimHarness![n](), name)) as ScenarioResult<K>;
  expect(result.errors, `GPU errors during ${name}`).toEqual([]);
  return result;
}

test('walls conserve total water within 0.5% over 500 steps', async ({ page }) => {
  const r = await run(page, 'conservation');
  expect(r.initial).toBeGreaterThan(0);
  expect(r.relError).toBeLessThan(0.005);
  expect(r.nanCount).toBe(0);
  expect(r.minDepth).toBeGreaterThanOrEqual(0);
});

test('water flows downhill towards the low side', async ({ page }) => {
  const r = await run(page, 'downhill');
  expect(r.centroidAfter).toBeGreaterThan(r.centroidBefore + 10);
  expect(r.centroidAfter).toBeLessThanOrEqual(r.lowSideX);
  expect(r.relMassError).toBeLessThan(0.005);
});

test('open south edge drains most water while walls keep it', async ({ page }) => {
  const r = await run(page, 'drain');
  expect(r.openFinal).toBeLessThan(r.initial * 0.2);
  expect(Math.abs(r.closedFinal - r.initial) / r.initial).toBeLessThan(0.005);
});

test('emission adds rate*dt*steps per cell and evaporation decays depth', async ({ page }) => {
  const r = await run(page, 'emission');
  const tol = r.expectedPerCell * 0.05;
  expect(Math.abs(r.meanPerCell - r.expectedPerCell)).toBeLessThan(tol);
  expect(Math.abs(r.minPerCell - r.expectedPerCell)).toBeLessThan(tol);
  expect(Math.abs(r.maxPerCell - r.expectedPerCell)).toBeLessThan(tol);
  expect(Math.abs(r.springTotal - r.springExpectedTotal) / r.springExpectedTotal).toBeLessThan(0.05);
  expect(Math.abs(r.evaporationMean - r.evaporationExpected) / r.evaporationExpected).toBeLessThan(0.01);
});

test('village probe max depth matches the CPU max over each circle', async ({ page }) => {
  const r = await run(page, 'probe');
  expect(r.gpuA).toHaveLength(r.cpuA.length);
  expect(r.gpuB).toHaveLength(r.cpuB.length);
  expect(r.maxAbsDiff).toBeLessThan(1e-6);
  // Sanity: the fixture's spikes (> base depth 3) are visible, and the fully-outside probe reads 0.
  expect(Math.max(...r.cpuA)).toBeGreaterThan(3);
  expect(r.cpuA[6]).toBe(0);
  expect(r.staleClearedOnSetProbes).toBe(true);
  expect(r.emptyProbeResultLength).toBe(0);
});

test('deep water dam break stays stable (no NaN, bounded depth)', async ({ page }) => {
  const r = await run(page, 'stability');
  expect(r.nanCount).toBe(0);
  expect(r.maxDepthSeen).toBeLessThan(r.initialMax * 2);
  expect(r.relMassError).toBeLessThan(0.005);
});

test('invalid inputs throw RangeError and non-finite/negative depths are sanitized', async ({ page }) => {
  const r = await run(page, 'inputValidation');
  expect(r.rangeErrorsThrown).toBe(r.rangeErrorsExpected);
  expect(r.sanitizedNaN).toBe(0);
  expect(r.sanitizedNegative).toBe(0);
});

test('configureCanvas applies the preferred format with opaque alpha', async ({ page }) => {
  const r = await run(page, 'canvas');
  expect(r.format).toMatch(/^(bgra8unorm|rgba8unorm)$/);
  expect(r.alphaMode).toBe('opaque');
});

test('all scenarios together raise no GPU validation errors', async ({ page }) => {
  const names: ScenarioName[] = ['canvas', 'conservation', 'downhill', 'drain', 'emission', 'probe', 'stability', 'inputValidation'];
  for (const name of names) await run(page, name);
  const uncaptured = await page.evaluate(() => window.__waterSimHarness!.uncapturedErrors());
  expect(uncaptured).toEqual([]);
});
