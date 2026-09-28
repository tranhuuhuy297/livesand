// Shared helpers for the app-shell e2e specs: GPU launch flags, boot/wait, debug-API access, mouse drags.
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import type {} from '../../src/app/livesand-debug-api';
import { scaled } from './e2e-timing';

export const SCREENS_DIR = fileURLToPath(new URL('../../e2e-screens/', import.meta.url));

// GPU-less hosts (CI) have no Vulkan driver, so the WebGPU canvas swap chain needs Chromium's bundled SwiftShader Vulkan.
const gpuArgs = ['--enable-unsafe-webgpu', '--enable-features=Vulkan'];
gpuArgs.push(...(process.env.LIVESAND_E2E_GPU === '1' ? ['--use-angle=vulkan'] : ['--use-angle=swiftshader', '--use-vulkan=swiftshader']));
/** Pass to test.use() in every app spec. */
export const APP_TEST_OPTIONS = { viewport: { width: 1280, height: 800 }, launchOptions: { args: gpuArgs } };

export interface AppState {
  view: '2d' | '3d';
  level: string;
  phase: 'ready' | 'running' | 'won' | 'lost';
  elapsedSec: number;
  durationSec: number | null;
  tool: string;
  villages: { name: string; state: string; floodedSec: number }[];
  gpuErrors: string[];
}

export function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(msg.text());
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

export async function openApp(page: Page, query: string): Promise<void> {
  // Retry: Vite may reload the page once while it pre-bundles dependencies on the first visit.
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(`/${query}`);
      await page.waitForFunction(() => window.__livesand?.ready === true || Boolean(window.__livesand?.error), null, { timeout: scaled(45_000) });
      break;
    } catch (err) {
      if (attempt >= 2) throw err;
    }
  }
  expect(await page.evaluate(() => window.__livesand?.error ?? null), 'app boot error').toBeNull();
}

export const appState = (page: Page): Promise<AppState> => page.evaluate(() => window.__livesand!.debug.state() as unknown as AppState);
export const stepFrames = (page: Page, n: number, dt: number): Promise<void> =>
  page.evaluate(([count, seconds]) => window.__livesand!.debug.stepFrames(count, seconds), [n, dt] as const);

export const waterSum = (page: Page): Promise<number> =>
  page.evaluate(async () => (await window.__livesand!.debug.readWater()).reduce((s, d) => s + d, 0));

/** Dispatches a synthetic touch PointerEvent on the canvas (the app only listens to pointer events). */
export const touchPointer = (page: Page, type: 'pointerdown' | 'pointermove' | 'pointerup', id: number, x: number, y: number): Promise<void> =>
  page.evaluate(([t, pointerId, clientX, clientY]) => {
    const init = { pointerId, pointerType: 'touch', clientX, clientY, button: t === 'pointermove' ? -1 : 0, isPrimary: pointerId === 1, bubbles: true, cancelable: true };
    document.querySelector('canvas.ls-canvas')!.dispatchEvent(new PointerEvent(t, init));
  }, [type, id, x, y] as const);

export async function heightsDelta(page: Page, action: () => Promise<void>): Promise<{ changed: number; maxAbs: number }> {
  await page.evaluate(() => {
    (window as unknown as { __before: Float32Array }).__before = window.__livesand!.debug.getHeights();
  });
  await action();
  return page.evaluate(() => {
    const before = (window as unknown as { __before: Float32Array }).__before;
    const after = window.__livesand!.debug.getHeights();
    let changed = 0;
    let maxAbs = 0;
    for (let i = 0; i < after.length; i++) {
      const d = Math.abs(after[i] - before[i]);
      if (d > 1e-4) changed++;
      maxAbs = Math.max(maxAbs, d);
    }
    return { changed, maxAbs };
  });
}

export async function dragOnCanvas(page: Page, holdMs: number): Promise<void> {
  const box = await page.locator('canvas.ls-canvas').boundingBox();
  if (!box) throw new Error('canvas has no layout box');
  const cx = box.x + box.width * 0.5;
  const cy = box.y + box.height * 0.55;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(cx + i * 3, cy + i * 2);
    await page.waitForTimeout(holdMs / steps);
  }
  await page.mouse.up();
  // Let the live loop apply the final brush frames.
  await page.waitForTimeout(200);
}
