// Ray -> heightfield intersection in the world space of gridToWorld (y up), returning grid coordinates.
import type { GridSize, Ray, Vec2 } from '../core/types';

// Ray-march step in world units along the unit ray: never skips more than half a cell horizontally.
const MARCH_STEP = 0.5;
const BISECTION_ITERATIONS = 24;
// Pads the top plane so a ray grazing the highest point still gets a non-empty march interval.
const SLAB_PAD = 1e-3;

/** Bilinear height at fractional grid coords, clamped to the grid. */
export function sampleHeightBilinear(heights: Float32Array, grid: GridSize, x: number, y: number): number {
  const { width, height } = grid;
  const cx = Math.min(width - 1, Math.max(0, x));
  const cy = Math.min(height - 1, Math.max(0, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = cx - x0;
  const ty = cy - y0;
  const top = heights[y0 * width + x0] * (1 - tx) + heights[y0 * width + x1] * tx;
  const bottom = heights[y1 * width + x0] * (1 - tx) + heights[y1 * width + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Clips [tMin, tMax] by one slab lo <= o + d*t <= hi; returns null when the ray misses it. */
function clipSlab(o: number, d: number, lo: number, hi: number, range: [number, number]): [number, number] | null {
  if (Math.abs(d) < 1e-12) return o < lo || o > hi ? null : range;
  let t0 = (lo - o) / d;
  let t1 = (hi - o) / d;
  if (t0 > t1) [t0, t1] = [t1, t0];
  const next: [number, number] = [Math.max(range[0], t0), Math.min(range[1], t1)];
  return next[0] <= next[1] ? next : null;
}

/** Lowest and highest surface points in world units, ignoring non-finite heights. */
function surfaceRange(heights: Float32Array, verticalScale: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < heights.length; i++) {
    const y = heights[i] * verticalScale;
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : [0, 0];
}

/**
 * First intersection of `ray` with the terrain surface (heights * verticalScale) inside the grid, in grid coords.
 * Rays entering through the side of the terrain block hit the side wall. Returns null on a miss.
 */
export function pickHeightfield(heights: Float32Array, grid: GridSize, verticalScale: number, ray: Ray): Vec2 | null {
  const { width, height } = grid;
  if (heights.length !== width * height || heights.length === 0) {
    throw new RangeError(`heights length ${heights.length} != grid ${width}x${height}`);
  }
  const [ox, oy, oz] = ray.origin;
  const len = Math.hypot(ray.dir[0], ray.dir[1], ray.dir[2]);
  if (!(len > 0) || !Number.isFinite(len) || ![ox, oy, oz].every(Number.isFinite)) return null;
  const dx = ray.dir[0] / len;
  const dy = ray.dir[1] / len;
  const dz = ray.dir[2] / len;
  const [bottom, top] = surfaceRange(heights, verticalScale);

  // World footprint of the heightfield (grid coords 0..W-1 map to x - W/2); the terrain is solid below its surface.
  let range: [number, number] | null = [0, Infinity];
  range = clipSlab(ox, dx, -width / 2, width / 2 - 1, range);
  if (range) range = clipSlab(oz, dz, -height / 2, height / 2 - 1, range);
  if (range) range = clipSlab(oy, dy, -Infinity, top + SLAB_PAD, range);
  if (!range) return null;
  const tEnter = range[0];
  // A descending ray must cross the surface before it drops below the lowest point (bounds vertical rays too).
  const maxDrop = top - bottom + 2 * SLAB_PAD + MARCH_STEP;
  const tExit = Math.min(range[1], dy < 0 ? tEnter + maxDrop / -dy : Infinity);

  const above = (t: number): number =>
    oy + dy * t - sampleHeightBilinear(heights, grid, ox + dx * t + width / 2, oz + dz * t + height / 2) * verticalScale;
  const toGrid = (t: number): Vec2 => ({
    x: Math.min(width - 1, Math.max(0, ox + dx * t + width / 2)),
    y: Math.min(height - 1, Math.max(0, oz + dz * t + height / 2)),
  });

  if (above(tEnter) <= 0) return toGrid(tEnter);
  let tPrev = tEnter;
  for (let t = tEnter + MARCH_STEP; tPrev < tExit; t += MARCH_STEP) {
    const tCur = Math.min(t, tExit);
    if (above(tCur) <= 0) {
      // Bisection keeps the bracket [above, below] and converges on the surface crossing.
      let a = tPrev;
      let b = tCur;
      for (let k = 0; k < BISECTION_ITERATIONS; k++) {
        const mid = 0.5 * (a + b);
        if (above(mid) > 0) a = mid;
        else b = mid;
      }
      return toGrid(0.5 * (a + b));
    }
    tPrev = tCur;
  }
  return null;
}
