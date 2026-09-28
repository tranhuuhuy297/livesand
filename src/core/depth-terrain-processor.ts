// Turns LiDAR depth frames into a stable sand heightmap (world units) plus a hand-hover mask.
import { DepthGridResampler } from './depth-bilinear-resampler';
import { assertValidGrid, cloneQuad, validateDepthCalibration, type DepthCalibration } from './depth-calibration';
import type { DepthFrame } from './depth-frame-protocol';
import { dilateMask, MaskedGaussianBlur } from './depth-grid-filters';
import type { GridSize } from './types';

export type { DepthCalibration } from './depth-calibration';
export { defaultDepthCalibration } from './depth-calibration';

export interface DepthProcessResult {
  heights: Float32Array;
  handMask: Uint8Array;
  changed: boolean;
}

// Changing these re-bases heights, so cells re-seed from their next valid sample instead of easing across.
const REBASE_KEYS: readonly (keyof DepthCalibration)[] = [
  'roiQuad', 'referenceDepth', 'referencePlaneMeters', 'unitsPerMeter', 'minHeight', 'maxHeight',
];

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function copyCalibration(cal: DepthCalibration): DepthCalibration {
  return { ...cal, roiQuad: cloneQuad(cal.roiQuad), referenceDepth: cal.referenceDepth ? cal.referenceDepth.slice() : null };
}

function assertFrame(frame: DepthFrame): void {
  if (!frame) throw new TypeError('Depth frame is required');
  const { width, height, depthMeters } = frame;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Invalid depth frame size ${width}x${height}`);
  }
  if (!(depthMeters instanceof Float32Array) || depthMeters.length !== width * height) {
    throw new RangeError(`Depth frame needs a Float32Array of ${width * height} pixels`);
  }
}

export class DepthTerrainProcessor {
  private readonly grid: GridSize;
  private cal: DepthCalibration;
  private resampler: DepthGridResampler | null = null;
  private blur: MaskedGaussianBlur | null = null;
  private readonly held: Float32Array;     // hysteresis-gated per-cell heights
  private readonly heights: Float32Array;  // published: `held`, spatially smoothed
  private readonly filtered: Float32Array; // per-cell EMA state
  private readonly seeded: Uint8Array;     // 1 once a cell had a valid sand sample since the last re-base
  private readonly rawHand: Uint8Array;
  private readonly handMask: Uint8Array;
  private readonly depthScratch: Float32Array;
  private pendingChange = true;

  constructor(grid: GridSize, calibration: DepthCalibration) {
    assertValidGrid(grid);
    validateDepthCalibration(calibration, grid);
    this.grid = { width: grid.width, height: grid.height };
    this.cal = copyCalibration(calibration);
    const n = grid.width * grid.height;
    const base = clamp(0, calibration.minHeight, calibration.maxHeight);
    this.held = new Float32Array(n).fill(base);
    this.heights = new Float32Array(n).fill(base);
    this.filtered = new Float32Array(n).fill(base);
    this.seeded = new Uint8Array(n);
    this.rawHand = new Uint8Array(n);
    this.handMask = new Uint8Array(n);
    this.depthScratch = new Float32Array(n);
  }

  get calibration(): DepthCalibration {
    return copyCalibration(this.cal);
  }

  /** Validates before applying; geometry/scale changes make every cell re-seed from its next valid sample. */
  setCalibration(patch: Partial<DepthCalibration>): void {
    const defined = Object.fromEntries(
      Object.entries(patch ?? {}).filter(([, v]) => v !== undefined),
    ) as Partial<DepthCalibration>;
    const next: DepthCalibration = { ...this.cal, ...defined };
    validateDepthCalibration(next, this.grid);
    this.cal = copyCalibration(next);
    if (REBASE_KEYS.some((k) => k in defined)) this.rebase();
    if ('spatialSigma' in defined) this.pendingChange = true;
  }

  /** Per-cell depth (m) via the ROI homography + invalid-aware bilinear sampling; 0 = invalid. */
  resampleDepth(frame: DepthFrame): Float32Array {
    return this.resampleInto(frame, new Float32Array(this.grid.width * this.grid.height));
  }

  /** Stores & returns the resampled flat-sand depth; holes are filled with the mean so they don't read as spikes. */
  captureReference(frame: DepthFrame): Float32Array {
    const ref = this.resampleDepth(frame);
    let sum = 0, count = 0;
    for (let i = 0; i < ref.length; i++) {
      if (ref[i] > 0) { sum += ref[i]; count++; }
    }
    if (count === 0) throw new Error('Cannot capture reference depth: no valid depth inside the sandbox area');
    const mean = sum / count;
    for (let i = 0; i < ref.length; i++) if (!(ref[i] > 0)) ref[i] = mean;
    this.cal.referenceDepth = ref.slice();
    this.rebase();
    return ref;
  }

  /** Heights persist across frames (EMA + hysteresis, then a spatial blur); hand and invalid cells keep their last value. */
  process(frame: DepthFrame): DepthProcessResult {
    const depth = this.resampleInto(frame, this.depthScratch);
    const {
      referenceDepth: refs, referencePlaneMeters: plane, unitsPerMeter: upm,
      minHeight, maxHeight, handMarginMeters, smoothing, changeThreshold,
    } = this.cal;
    const handOffset = maxHeight / upm + handMarginMeters;
    const n = depth.length;
    for (let i = 0; i < n; i++) {
      const d = depth[i];
      const ref = refs !== null && refs[i] > 0 ? refs[i] : plane;
      this.rawHand[i] = d > 0 && d < ref - handOffset ? 1 : 0;
    }
    dilateMask(this.rawHand, this.handMask, this.grid);

    let changed = this.pendingChange;
    this.pendingChange = false;
    for (let i = 0; i < n; i++) {
      const d = depth[i];
      if (this.handMask[i] || !(d > 0)) continue;
      const ref = refs !== null && refs[i] > 0 ? refs[i] : plane;
      const target = Math.fround(clamp((ref - d) * upm, minHeight, maxHeight));
      if (!this.seeded[i]) {
        // First valid sample since (re)start: take it directly instead of easing in from a stale value.
        this.seeded[i] = 1;
        this.filtered[i] = target;
        if (this.held[i] !== target) { this.held[i] = target; changed = true; }
        continue;
      }
      const f = Math.fround(this.filtered[i] + smoothing * (target - this.filtered[i]));
      this.filtered[i] = f;
      if (f !== this.held[i] && Math.abs(f - this.held[i]) >= changeThreshold) {
        this.held[i] = f;
        changed = true;
      }
    }
    if (changed) this.publish();
    return { heights: this.heights.slice(), handMask: this.handMask.slice(), changed };
  }

  /** Smooths the held heights over cells that have seen sand; unseen cells never pull their neighbours down. */
  private publish(): void {
    const sigma = this.cal.spatialSigma;
    if (!(sigma > 0)) return void this.heights.set(this.held);
    if (this.blur?.sigma !== sigma) this.blur = new MaskedGaussianBlur(this.grid, sigma);
    this.blur.apply(this.held, this.seeded, this.heights);
  }

  private resampleInto(frame: DepthFrame, out: Float32Array): Float32Array {
    assertFrame(frame);
    const { roiQuad } = this.cal;
    if (!this.resampler || !this.resampler.matches(roiQuad, frame.width, frame.height)) {
      this.resampler = new DepthGridResampler(this.grid, roiQuad, frame.width, frame.height);
    }
    return this.resampler.resample(frame.depthMeters, out);
  }

  private rebase(): void {
    const { minHeight, maxHeight } = this.cal;
    this.seeded.fill(0);
    for (let i = 0; i < this.held.length; i++) {
      this.held[i] = clamp(this.held[i], minHeight, maxHeight);
      this.filtered[i] = this.held[i];
    }
    this.pendingChange = true;
  }
}
