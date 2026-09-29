import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { scaled } from './e2e-timing';

interface PixelStats {
  distinctColors: number;
  lumaStdDev: number;
  warmFraction: number;
  probes: Record<string, [number, number, number]>;
}

interface HarnessSnapshot {
  ready: boolean;
  error?: string;
  errors: string[];
  stats?: { view2d: PixelStats; view3d: PixelStats };
}

const SCREENS_DIR = fileURLToPath(new URL('../../e2e-screens/', import.meta.url));
const GPU_CONSOLE = /webgpu|wgsl|gpu|validation|shader|pipeline/i;

test.use({ viewport: { width: 2080, height: 800 } });

async function waitForHarness(page: Page): Promise<HarnessSnapshot> {
  // Retry: Vite may reload the page once while it pre-bundles dependencies on first visit.
  for (let attempt = 0; ; attempt++) {
    try {
      await page.waitForFunction(
        () => {
          const h = (window as unknown as { __harness?: HarnessSnapshot }).__harness;
          return Boolean(h && (h.ready || h.error));
        },
        null,
        { timeout: scaled(45_000) },
      );
      return await page.evaluate(() => {
        const h = (window as unknown as { __harness: HarnessSnapshot }).__harness;
        return { ready: h.ready, error: h.error, errors: [...h.errors], stats: h.stats };
      });
    } catch (err) {
      if (attempt >= 2) throw err;
    }
  }
}

function collectGpuConsoleProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if ((msg.type() === 'error' || msg.type() === 'warning') && GPU_CONSOLE.test(msg.text())) problems.push(msg.text());
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

test('top-down and 3D renderers draw terrain, water and villages without GPU errors', async ({ page }) => {
  const consoleProblems = collectGpuConsoleProblems(page);

  await page.goto('/tests/gpu-harness/renderers-harness.html');
  const harness = await waitForHarness(page);

  expect(harness.error, 'harness setup error').toBeUndefined();
  expect(harness.ready).toBe(true);
  expect(harness.errors, 'GPU validation / uncaptured errors').toEqual([]);
  expect(consoleProblems, 'GPU-related console errors').toEqual([]);

  const stats = harness.stats;
  expect(stats).toBeDefined();
  if (!stats) return;
  // Non-uniform output: many distinct colours and real luminance variation in both views.
  expect(stats.view2d.distinctColors).toBeGreaterThan(150);
  expect(stats.view2d.lumaStdDev).toBeGreaterThan(12);
  expect(stats.view3d.distinctColors).toBeGreaterThan(150);
  expect(stats.view3d.lumaStdDev).toBeGreaterThan(12);
  // Semantic spot checks: the lake is blue in the map; the top of the 3D view is sky.
  const [lr, lg, lb] = stats.view2d.probes.lake;
  expect(lb).toBeGreaterThan(lr + 40);
  expect(lb).toBeGreaterThan(lg - 10);
  const [sr, , sb] = stats.view3d.probes.sky;
  expect(sb).toBeGreaterThan(sr);
  expect(sb).toBeGreaterThan(150);

  mkdirSync(SCREENS_DIR, { recursive: true });
  await page.locator('#view2d').screenshot({ path: `${SCREENS_DIR}renderer-2d.png` });
  await page.locator('#view3d').screenshot({ path: `${SCREENS_DIR}renderer-3d.png` });

  // A later animation frame must also render cleanly.
  await page.evaluate(() => (window as unknown as { __harness: { renderAt(t: number): Promise<void> } }).__harness.renderAt(5.5));
  const after = await page.evaluate(() => (window as unknown as { __harness: HarnessSnapshot }).__harness.errors);
  expect(after).toEqual([]);
});

test('volcano scene: molten lava glows warm, basalt is dark and steam rises where lava meets the lake', async ({ page }) => {
  const consoleProblems = collectGpuConsoleProblems(page);
  await page.goto('/tests/gpu-harness/renderers-harness.html?scene=volcano&t=3.2');
  const harness = await waitForHarness(page);

  expect(harness.error, 'harness setup error').toBeUndefined();
  expect(harness.ready).toBe(true);
  expect(harness.errors, 'GPU validation / uncaptured errors').toEqual([]);
  expect(consoleProblems, 'GPU-related console errors').toEqual([]);
  const stats = harness.stats;
  expect(stats).toBeDefined();
  if (!stats) return;

  mkdirSync(SCREENS_DIR, { recursive: true });
  await page.locator('#view2d').screenshot({ path: `${SCREENS_DIR}renderer-lava-2d.png` });
  await page.locator('#view3d').screenshot({ path: `${SCREENS_DIR}renderer-lava-3d.png` });

  for (const [name, view] of [['2d', stats.view2d], ['3d', stats.view3d]] as const) {
    expect(view.distinctColors, `${name} distinct colours`).toBeGreaterThan(150);
    expect(view.lumaStdDev, `${name} luma spread`).toBeGreaterThan(12);
    expect(view.warmFraction, `${name} share of fiery pixels`).toBeGreaterThan(0.01);
    // Lava in the crater and down the flank is incandescent: red channel far above blue.
    for (const probe of ['crater', 'flow']) {
      const rgb = view.probes[probe];
      expect(rgb, `${name} ${probe} probe`).toBeDefined();
      const [r, g, b] = rgb;
      expect(r, `${name} ${probe} red ${rgb.join(',')}`).toBeGreaterThan(130);
      expect(r, `${name} ${probe} red vs blue ${rgb.join(',')}`).toBeGreaterThan(b + 90);
      expect(r, `${name} ${probe} red vs green ${rgb.join(',')}`).toBeGreaterThanOrEqual(g);
    }
    // Basalt (old flow and rock field) is dark, near-neutral rock, unlike the green ground around it.
    for (const probe of ['basalt', 'field']) {
      const rgb = view.probes[probe];
      expect(rgb[0] + rgb[1] + rgb[2], `${name} ${probe} brightness ${rgb.join(',')}`).toBeLessThan(240);
      expect(Math.max(...rgb) - Math.min(...rgb), `${name} ${probe} is grey ${rgb.join(',')}`).toBeLessThan(35);
    }
    const [lr, , lb] = view.probes.lake;
    expect(lb, `${name} lake blue`).toBeGreaterThan(lr + 30);
  }
  // Steam over the water just off the lava front reads white-grey, not lake blue.
  const [sr, sg, sb] = stats.view2d.probes.steam;
  expect(sr, `2d steam ${sr},${sg},${sb}`).toBeGreaterThan(stats.view2d.probes.lake[0] + 60);
  expect(sb - sr, `2d steam is neutral ${sr},${sg},${sb}`).toBeLessThan(45);

  // Later animation frames (crust drift, steam puffs) must also render cleanly, as must switching lava off and on again.
  await page.evaluate(async () => {
    const h = (window as unknown as { __harness: { renderAt(t: number): Promise<void>; setLava(on: boolean): void } }).__harness;
    h.setLava(false);
    await h.renderAt(7.5);
    h.setLava(true);
    await h.renderAt(7.9);
  });
  const after = await page.evaluate(() => (window as unknown as { __harness: HarnessSnapshot }).__harness.errors);
  expect(after).toEqual([]);
});
