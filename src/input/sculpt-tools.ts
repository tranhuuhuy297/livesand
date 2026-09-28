// Terrain sculpting brushes on the CPU heightmap (grid coords, heights in world units).
import type { GridSize } from '../core/types';

export type SculptTool = 'raise' | 'lower' | 'smooth' | 'flatten' | 'rain';

/** strength: world units/s at the brush centre (smooth: blend fraction/s toward the local average). */
export interface BrushSettings {
  radius: number;
  strength: number;
}

interface BrushRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function assertField(field: ArrayLike<number>, grid: GridSize, name: string): void {
  if (field.length !== grid.width * grid.height) {
    throw new RangeError(`${name} length ${field.length} != grid ${grid.width}x${grid.height}`);
  }
}

/** Smooth cosine falloff: 1 at the centre, 0 at the rim, zero slope at both ends (no visible brush edge). */
export function brushFalloff(distance: number, radius: number): number {
  if (!(radius > 0) || distance >= radius) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * distance) / radius));
}

/** Grid-clipped bounding box of a brush, or null if it misses the grid or the inputs are unusable. */
function brushRect(grid: GridSize, cx: number, cy: number, radius: number): BrushRect | null {
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !(radius > 0) || !Number.isFinite(radius)) return null;
  const rect = {
    x0: Math.max(0, Math.ceil(cx - radius)),
    x1: Math.min(grid.width - 1, Math.floor(cx + radius)),
    y0: Math.max(0, Math.ceil(cy - radius)),
    y1: Math.min(grid.height - 1, Math.floor(cy + radius)),
  };
  return rect.x0 <= rect.x1 && rect.y0 <= rect.y1 ? rect : null;
}

function sampleNearest(heights: Float32Array, grid: GridSize, x: number, y: number): number {
  const ix = Math.min(grid.width - 1, Math.max(0, Math.round(x)));
  const iy = Math.min(grid.height - 1, Math.max(0, Math.round(y)));
  return heights[iy * grid.width + ix];
}

/** 3x3 averages over the rect, computed before any write so smoothing never reads half-updated neighbours. */
function rectAverages(heights: Float32Array, grid: GridSize, rect: BrushRect): Float32Array {
  const rw = rect.x1 - rect.x0 + 1;
  const out = new Float32Array(rw * (rect.y1 - rect.y0 + 1));
  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      let sum = 0;
      let count = 0;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(grid.height - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(grid.width - 1, x + 1); nx++) {
          sum += heights[ny * grid.width + nx];
          count++;
        }
      }
      out[(y - rect.y0) * rw + (x - rect.x0)] = sum / count;
    }
  }
  return out;
}

/**
 * Applies one brush step. raise/lower move by strength*dt*falloff; smooth blends toward the 3x3 average;
 * flatten moves toward `flattenTarget` (default: height under the centre now; callers pass the stroke-start value).
 * Results are clamped to `bounds`. Returns true if any height changed.
 */
export function applySculptBrush(
  heights: Float32Array,
  grid: GridSize,
  cx: number,
  cy: number,
  tool: Exclude<SculptTool, 'rain'>,
  brush: BrushSettings,
  dtSec: number,
  bounds: { min: number; max: number },
  flattenTarget?: number,
): boolean {
  assertField(heights, grid, 'heights');
  if (!(dtSec > 0) || !(brush.strength > 0) || !Number.isFinite(dtSec) || !Number.isFinite(brush.strength)) return false;
  const rect = brushRect(grid, cx, cy, brush.radius);
  if (!rect) return false;
  // Non-finite bounds mean "unbounded" rather than poisoning heights with NaN.
  const lo = Math.min(Number.isFinite(bounds.min) ? bounds.min : -Infinity, Number.isFinite(bounds.max) ? bounds.max : Infinity);
  const hi = Math.max(Number.isFinite(bounds.min) ? bounds.min : -Infinity, Number.isFinite(bounds.max) ? bounds.max : Infinity);
  const step = brush.strength * dtSec;
  const target = flattenTarget !== undefined && Number.isFinite(flattenTarget) ? flattenTarget : sampleNearest(heights, grid, cx, cy);
  const averages = tool === 'smooth' ? rectAverages(heights, grid, rect) : null;
  const rw = rect.x1 - rect.x0 + 1;
  let changed = false;
  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      const w = brushFalloff(Math.hypot(x - cx, y - cy), brush.radius);
      if (w <= 0) continue;
      const i = y * grid.width + x;
      const h = heights[i];
      let next = h;
      if (tool === 'raise') next = h + step * w;
      else if (tool === 'lower') next = h - step * w;
      else if (averages) next = h + (averages[(y - rect.y0) * rw + (x - rect.x0)] - h) * Math.min(1, step * w);
      else next = h + Math.max(-step * w, Math.min(step * w, target - h));
      next = Math.min(hi, Math.max(lo, next));
      if (next !== h) {
        heights[i] = next;
        changed = true;
      }
    }
  }
  return changed;
}

/** Paints rain (units/s) with the same falloff; keeps the max so repainting a spot never stacks up. */
export function paintRainBrush(field: Float32Array, grid: GridSize, cx: number, cy: number, radius: number, rate: number): void {
  assertField(field, grid, 'field');
  if (!(rate > 0) || !Number.isFinite(rate)) return;
  const rect = brushRect(grid, cx, cy, radius);
  if (!rect) return;
  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      const value = rate * brushFalloff(Math.hypot(x - cx, y - cy), radius);
      const i = y * grid.width + x;
      if (value > field[i]) field[i] = value;
    }
  }
}
