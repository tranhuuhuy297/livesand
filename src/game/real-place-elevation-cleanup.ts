// Cleans raw DEM grids: SRTM void-fill artifacts (isolated spikes/pits hundreds of meters off) and, when relief is
// exaggerated a lot, the few-meter canopy/building noise that would otherwise turn flat deltas into bumpy fields.
import type { GridSize } from '../core/types';

// Spikes must stand this far past their neighbours: at least MIN, and half the regional (p1..p99) relief so steep
// real peaks in mountains survive while a 50 m artifact in a flat delta does not.
const MIN_SPIKE_MARGIN_METERS = 30;
const SPIKE_PASSES = 4;

export function spikeMarginMeters(meters: Float32Array): number {
  if (meters.length === 0) return MIN_SPIKE_MARGIN_METERS;
  const sorted = Float32Array.from(meters).sort();
  const at = (p: number) => sorted[Math.round(p * (sorted.length - 1))];
  return Math.max(MIN_SPIKE_MARGIN_METERS, 0.5 * (at(0.99) - at(0.01)));
}

/** The 8 neighbours of an interior cell, sorted ascending. */
function sortedNeighbours(values: Float32Array, width: number, i: number, out: number[]): number[] {
  out.length = 0;
  for (const d of [-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1]) out.push(values[i + d]);
  return out.sort((a, b) => a - b);
}

/**
 * Replaces spikes and pits with the median of their neighbours. Comparing against the 2nd-extreme neighbour lets
 * adjacent artifacts peel off over successive passes, while cliffs stay because their rim neighbours are level.
 * Returns the number of cells replaced; `meters` is modified in place.
 */
export function removeElevationSpikes(meters: Float32Array, grid: GridSize, margin = spikeMarginMeters(meters)): number {
  const { width, height } = grid;
  let replaced = 0;
  const nb: number[] = [];
  for (let pass = 0; pass < SPIKE_PASSES; pass++) {
    const fixes: [number, number][] = [];
    // Border cells are skipped: with only 5 neighbours a cliff meeting the edge looks like a spike.
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const n = sortedNeighbours(meters, width, i, nb);
        if (meters[i] > n[6] + margin || meters[i] < n[1] - margin) fixes.push([i, (n[3] + n[4]) / 2]);
      }
    }
    if (fixes.length === 0) break;
    for (const [i, value] of fixes) meters[i] = value;
    replaced += fixes.length;
  }
  return replaced;
}

/**
 * Binomial 3x3 blur over land cells only (neighbours at or below `waterMaxMeters` are ignored), so coastlines and
 * sea-level river channels stay crisp while land noise is averaged away. Returns a new array.
 */
export function smoothLandElevation(meters: Float32Array, grid: GridSize, passes: number, waterMaxMeters: number): Float32Array {
  const { width, height } = grid;
  let src = meters.slice();
  for (let pass = 0; pass < passes; pass++) {
    const dst = src.slice();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (src[y * width + x] <= waterMaxMeters) continue;
        let sum = 0;
        let weight = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            const v = src[yy * width + xx];
            if (v <= waterMaxMeters) continue;
            const w = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
            sum += v * w;
            weight += w;
          }
        }
        dst[y * width + x] = sum / weight;
      }
    }
    src = dst;
  }
  return src;
}

/**
 * Raises sea-level components smaller than `minCells` that do not touch the border (ponds, paddies and data holes
 * at 0 m) just above `waterMaxMeters`, so they read as low land instead of freckles of ocean. Returns a new array.
 */
export function fillInlandSeaSpecks(meters: Float32Array, grid: GridSize, waterMaxMeters: number, minCells: number): Float32Array {
  const { width, height } = grid;
  const out = meters.slice();
  const seen = new Uint8Array(meters.length);
  const stack: number[] = [];
  for (let start = 0; start < meters.length; start++) {
    if (seen[start] || meters[start] > waterMaxMeters) continue;
    const component: number[] = [];
    let touchesBorder = false;
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      component.push(i);
      const x = i % width;
      const y = (i - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (!seen[j] && meters[j] <= waterMaxMeters) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (!touchesBorder && component.length < minCells) for (const i of component) out[i] = waterMaxMeters + 0.01;
  }
  return out;
}
