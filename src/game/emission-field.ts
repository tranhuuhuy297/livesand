// Per-cell water emission (units/s) fed to the simulation: springs + global storm rain + brush rain + hand rain.
import type { GridSize } from '../core/types';
import type { WaterSourceSpec } from './level-definitions';
import { assertValidGrid, layoutToCell } from './terrain-generators';

// A source smaller than this still covers its nearest cell (half the cell diagonal is ~0.707).
const MIN_SOURCE_RADIUS_CELLS = 0.75;

function nonNegative(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Stamps one spring disk (radius as a fraction of grid width) additively into `out`. */
function stampSource(out: Float32Array, grid: GridSize, source: WaterSourceSpec): void {
  const rate = nonNegative(source.rate);
  if (rate === 0 || !Number.isFinite(source.u) || !Number.isFinite(source.v)) return;
  const { width, height } = grid;
  const cx = layoutToCell(source.u, width);
  const cy = layoutToCell(source.v, height);
  const r = Math.max(MIN_SOURCE_RADIUS_CELLS, nonNegative(source.radius) * Math.max(1, width - 1));
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(width - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(height - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) out[y * width + x] += rate;
    }
  }
}

/**
 * Builds the emission field. `brushRain` is added per cell, `handMask` cells get `handRainRate`.
 * Pass `out` to reuse a buffer across frames instead of allocating.
 */
export function buildEmissionField(
  grid: GridSize,
  sources: WaterSourceSpec[],
  globalRain: number,
  brushRain: Float32Array | null,
  handMask: Uint8Array | null,
  handRainRate: number,
  out?: Float32Array,
): Float32Array {
  assertValidGrid(grid);
  const n = grid.width * grid.height;
  if (brushRain && brushRain.length !== n) throw new RangeError(`brushRain length ${brushRain.length} != ${n}`);
  if (handMask && handMask.length !== n) throw new RangeError(`handMask length ${handMask.length} != ${n}`);
  if (out && out.length !== n) throw new RangeError(`out length ${out.length} != ${n}`);
  const field = out ?? new Float32Array(n);
  field.fill(nonNegative(globalRain));
  if (brushRain) {
    for (let i = 0; i < n; i++) {
      const b = brushRain[i];
      if (b > 0) field[i] += b;
    }
  }
  const hand = nonNegative(handRainRate);
  if (handMask && hand > 0) {
    for (let i = 0; i < n; i++) if (handMask[i]) field[i] += hand;
  }
  for (const source of sources) stampSource(field, grid, source);
  return field;
}

/** Spring positions in grid cells, for drawing their markers. */
export function sourceMarkers(grid: GridSize, sources: readonly WaterSourceSpec[]): { x: number; y: number; radius: number }[] {
  return sources
    .filter((s) => nonNegative(s.rate) > 0 && Number.isFinite(s.u) && Number.isFinite(s.v))
    .map((s) => ({
      x: layoutToCell(s.u, grid.width),
      y: layoutToCell(s.v, grid.height),
      radius: Math.max(MIN_SOURCE_RADIUS_CELLS, nonNegative(s.radius) * Math.max(1, grid.width - 1)),
    }));
}
