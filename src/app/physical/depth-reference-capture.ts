// Per-pixel median over several depth frames: the flat-sand reference without sensor noise or a passing hand.
import type { DepthFrame } from '../../core/depth-frame-protocol';

export const REFERENCE_CAPTURE_FRAMES = 15;

export class DepthMedianAccumulator {
  readonly width: number;
  readonly height: number;
  readonly capacity: number;
  private readonly stack: Float32Array;
  private added = 0;
  private lastTimestamp = 0;

  constructor(width: number, height: number, capacity = REFERENCE_CAPTURE_FRAMES) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('capacity must be a positive integer');
    this.width = width;
    this.height = height;
    this.capacity = capacity;
    this.stack = new Float32Array(width * height * capacity);
  }

  get count(): number {
    return this.added;
  }

  get complete(): boolean {
    return this.added >= this.capacity;
  }

  /** Returns false (ignored) when the frame size differs or the stack is already full. */
  add(frame: DepthFrame): boolean {
    if (this.complete || frame.width !== this.width || frame.height !== this.height) return false;
    this.stack.set(frame.depthMeters, this.added * this.width * this.height);
    this.lastTimestamp = frame.timestampMs;
    this.added++;
    return true;
  }

  /** Median of the valid (> 0) samples per pixel; 0 where no sample was valid. */
  median(): DepthFrame {
    const n = this.width * this.height;
    const out = new Float32Array(n);
    const samples = new Float32Array(this.capacity);
    for (let i = 0; i < n; i++) {
      let k = 0;
      for (let f = 0; f < this.added; f++) {
        const d = this.stack[f * n + i];
        if (!(d > 0)) continue;
        // Insertion sort: at most ~15 values per pixel.
        let j = k++;
        while (j > 0 && samples[j - 1] > d) {
          samples[j] = samples[j - 1];
          j--;
        }
        samples[j] = d;
      }
      if (k === 0) continue;
      out[i] = k % 2 === 1 ? samples[(k - 1) >> 1] : (samples[k / 2 - 1] + samples[k / 2]) / 2;
    }
    return { width: this.width, height: this.height, timestampMs: this.lastTimestamp, frameIndex: 0, depthMeters: out };
  }
}
