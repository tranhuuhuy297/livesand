// Page helpers for the physical-mode e2e: harness loading, window hooks, pointer drags.
import type { Page } from '@playwright/test';
import { scaled } from './e2e-timing';

export interface Stats { polls: number; maxHeight: number; flat: number; handCells: number }
export interface Status { connected: boolean; sources: number; fps: number; calibrated: boolean; message: string }
export type Quad4 = { x: number; y: number }[];
interface ControllerHandle {
  status: Status;
  calibration: Record<string, unknown> | null;
  applyCalibration(cal: unknown, persist?: boolean): void;
  openCalibration(): void;
}
export type TestWindow = Window & {
  __physicalHarness?: { ready: boolean; errors: string[]; stats: Stats; resetStats(): void };
  __livesandPhysical?: ControllerHandle;
};

export async function openHarness(page: Page, relayUrl: string): Promise<void> {
  const url = `/tests/gpu-harness/physical-harness.html?relay=${encodeURIComponent(relayUrl)}`;
  // Retry: Vite may reload the page once while it pre-bundles dependencies (qrcode) on first visit.
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(url);
      await page.waitForFunction(() => (window as TestWindow).__physicalHarness?.ready === true, null, { timeout: scaled(30_000) });
      return;
    } catch (err) {
      if (attempt >= 2) throw err;
    }
  }
}

// A missing hook means the page reloaded underneath the test (e.g. Vite re-optimized dependencies).
const RELOADED = 'harness page reloaded unexpectedly';

export async function stats(page: Page): Promise<Stats> {
  const s = await page.evaluate(() => (window as TestWindow).__physicalHarness?.stats ?? null);
  if (!s) throw new Error(RELOADED);
  return s;
}

export async function status(page: Page): Promise<Status> {
  const s = await page.evaluate(() => (window as TestWindow).__livesandPhysical?.status ?? null);
  if (!s) throw new Error(RELOADED);
  return s;
}

export async function dragBy(page: Page, selector: string, dx: number, dy: number): Promise<void> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}
