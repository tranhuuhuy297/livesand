import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { scaled } from './e2e-timing';

interface PixelStats {
  distinctColors: number;
  lumaStdDev: number;
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

test('top-down and 3D renderers draw terrain, water and villages without GPU errors', async ({ page }) => {
  const consoleProblems: string[] = [];
  page.on('console', (msg) => {
    if ((msg.type() === 'error' || msg.type() === 'warning') && GPU_CONSOLE.test(msg.text())) consoleProblems.push(msg.text());
  });
  page.on('pageerror', (err) => consoleProblems.push(`pageerror: ${err.message}`));

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
