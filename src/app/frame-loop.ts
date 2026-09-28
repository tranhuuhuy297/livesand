// requestAnimationFrame loop with clamped frame time, pausing for scripted stepping and fatal-error capture.

/** Longest real frame time fed to the app; a backgrounded tab resuming must not jump the simulation. */
export const MAX_FRAME_DT_SEC = 0.1;

export class FrameLoop {
  private readonly tick: (dtSec: number, nowMs: number) => void;
  private readonly onError: (err: unknown) => void;
  private handle = 0;
  private lastMs: number | null = null;
  private running = false;
  private pauseDepth = 0;
  private smoothedFps = 0;

  constructor(tick: (dtSec: number, nowMs: number) => void, onError: (err: unknown) => void) {
    this.tick = tick;
    this.onError = onError;
  }

  /** Exponentially smoothed frames per second of the live loop. */
  get fps(): number {
    return this.smoothedFps;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastMs = null;
    this.handle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.handle);
  }

  /** Runs `work` with live ticks suspended so scripted frames never interleave with real ones. */
  async runPaused<T>(work: () => Promise<T>): Promise<T> {
    this.pauseDepth++;
    try {
      return await work();
    } finally {
      this.pauseDepth--;
      this.lastMs = null;
    }
  }

  private readonly frame = (nowMs: number): void => {
    if (!this.running) return;
    this.handle = requestAnimationFrame(this.frame);
    if (this.pauseDepth > 0) return;
    const dt = this.lastMs === null ? 1 / 60 : Math.min(Math.max((nowMs - this.lastMs) / 1000, 0), MAX_FRAME_DT_SEC);
    this.lastMs = nowMs;
    if (dt > 0) this.smoothedFps = this.smoothedFps === 0 ? 1 / dt : this.smoothedFps * 0.9 + (1 / dt) * 0.1;
    try {
      this.tick(dt, nowMs);
    } catch (err) {
      this.stop();
      this.onError(err);
    }
  };
}
