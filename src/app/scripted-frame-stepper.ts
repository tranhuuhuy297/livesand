// Deterministic frame stepping for the debug API: live loop paused, fixed dt, each frame's GPU work awaited.
import type { FrameLoop } from './frame-loop';

const MAX_SCRIPTED_FRAMES = 100_000;

/** Yields one macrotask via MessageChannel (setTimeout is clamped/throttled) so map callbacks can run. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/** Runs `n` frames of `dtSec`; `frame(dt, draw)` draws only on the last one (none unless `drawLast`) to keep fast-forwarding cheap. */
export async function stepFramesScripted(
  loop: FrameLoop,
  device: GPUDevice,
  n: number,
  dtSec: number,
  frame: (dtSec: number, draw: boolean) => void,
  drawLast = true,
): Promise<void> {
  if (!Number.isInteger(n) || n < 0 || n > MAX_SCRIPTED_FRAMES) {
    throw new RangeError(`stepFrames: n must be an integer in [0, ${MAX_SCRIPTED_FRAMES}], got ${n}`);
  }
  if (!Number.isFinite(dtSec) || dtSec <= 0 || dtSec > 1) {
    throw new RangeError(`stepFrames: dtSec must be in (0, 1], got ${dtSec}`);
  }
  await loop.runPaused(async () => {
    for (let i = 0; i < n; i++) {
      frame(dtSec, drawLast && i === n - 1);
      // Waiting for the GPU keeps probe readbacks one frame behind at most, as in live play.
      await device.queue.onSubmittedWorkDone();
      await yieldToEventLoop();
    }
  });
}
