// Resamples a depth image onto the simulation grid through the ROI homography (bilinear, invalid-aware).
import { gridRectQuad } from './depth-calibration';
import { applyHomography, computeHomography } from './homography';
import type { GridSize, Quad } from './types';

// Below this total weight of valid neighbours the sample counts as invalid.
const MIN_VALID_WEIGHT = 1e-6;

/**
 * Bilinear sample at continuous pixel-index coords (fx, fy) (pixel i centre = i).
 * Invalid (<= 0) and out-of-image neighbours are dropped and the remaining weights renormalized; 0 if none valid.
 */
export function sampleDepthBilinear(depth: Float32Array, width: number, height: number, fx: number, fy: number): number {
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  let sum = 0, wsum = 0;
  for (let j = 0; j < 2; j++) {
    const y = y0 + j;
    if (y < 0 || y >= height) continue;
    const wy = j === 0 ? 1 - ty : ty;
    for (let i = 0; i < 2; i++) {
      const x = x0 + i;
      if (x < 0 || x >= width) continue;
      const d = depth[y * width + x];
      if (!(d > 0 && d < Infinity)) continue;
      const w = (i === 0 ? 1 - tx : tx) * wy;
      sum += d * w;
      wsum += w;
    }
  }
  return wsum > MIN_VALID_WEIGHT ? sum / wsum : 0;
}

/** Precomputed grid-cell-centre -> depth-pixel lookup for one ROI and depth image size. */
export class DepthGridResampler {
  readonly grid: GridSize;
  readonly depthWidth: number;
  readonly depthHeight: number;
  private readonly quadKey: number[];
  // Interleaved (fx, fy) pixel-index coords per grid cell.
  private readonly coords: Float64Array;

  constructor(grid: GridSize, roiQuad: Quad, depthWidth: number, depthHeight: number) {
    this.grid = { width: grid.width, height: grid.height };
    this.depthWidth = depthWidth;
    this.depthHeight = depthHeight;
    this.quadKey = roiQuad.flatMap((p) => [p.x, p.y]);
    // Grid rect -> ROI quad is the inverse of the ROI -> grid homography.
    const gridToDepth = computeHomography(gridRectQuad(grid), roiQuad);
    const { width, height } = grid;
    this.coords = new Float64Array(width * height * 2);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = applyHomography(gridToDepth, { x: x + 0.5, y: y + 0.5 });
        const i = (y * width + x) * 2;
        // Continuous pixel coords put pixel centres at +0.5; convert to index space.
        this.coords[i] = p.x - 0.5;
        this.coords[i + 1] = p.y - 0.5;
      }
    }
  }

  /** True if this lookup is still valid for the given ROI / image size (compares values, not identity). */
  matches(roiQuad: Quad, depthWidth: number, depthHeight: number): boolean {
    if (depthWidth !== this.depthWidth || depthHeight !== this.depthHeight) return false;
    for (let k = 0; k < 4; k++) {
      if (roiQuad[k].x !== this.quadKey[k * 2] || roiQuad[k].y !== this.quadKey[k * 2 + 1]) return false;
    }
    return true;
  }

  /** Writes per-cell depth (m, 0 = invalid) into `out` and returns it. */
  resample(depthMeters: Float32Array, out: Float32Array): Float32Array {
    const n = this.grid.width * this.grid.height;
    if (depthMeters.length !== this.depthWidth * this.depthHeight) {
      throw new RangeError(`Depth image has ${depthMeters.length} pixels, expected ${this.depthWidth * this.depthHeight}`);
    }
    if (out.length !== n) throw new RangeError(`Output has ${out.length} cells, expected ${n}`);
    const c = this.coords;
    for (let i = 0; i < n; i++) {
      out[i] = sampleDepthBilinear(depthMeters, this.depthWidth, this.depthHeight, c[i * 2], c[i * 2 + 1]);
    }
    return out;
  }
}
