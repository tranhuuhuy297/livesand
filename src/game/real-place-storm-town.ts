// Where the "Flood it" storm challenge puts the player's town: low, flat, dry ground near the map centre (where the
// player asked for), off the river channels themselves, which flood first.
import type { GridSize } from '../core/types';
import { flowAccumulation } from './terrain-flow-routing';

// Search rings around the centre, as fractions of the map width; the first ring with a candidate wins.
const SEARCH_RADII = [0.07, 0.14, 0.3];
const TOWN_ABOVE_SEA_UNITS = 0.4;
// Share of the map draining through a cell before it counts as a river channel (~250 cells on the 256x192 grid).
const CHANNEL_SHARE = 0.005;
// Towns stand on flat ground: 5x5 patches spanning more than this (world units) are slopes or canyon walls.
const MAX_PATCH_SPAN_UNITS = 2;

interface Patch {
  mean: number;
  span: number;
  dry: boolean;
  channel: boolean;
}

function patchAt(heights: Float32Array, acc: Float32Array, width: number, x: number, y: number, seaLevel: number): Patch {
  const channelCells = CHANNEL_SHARE * heights.length;
  let sum = 0;
  let lo = Infinity;
  let hi = -Infinity;
  let channel = false;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const i = (y + dy) * width + x + dx;
      sum += heights[i];
      lo = Math.min(lo, heights[i]);
      hi = Math.max(hi, heights[i]);
      channel ||= acc[i] >= channelCells;
    }
  }
  return { mean: sum / 25, span: hi - lo, dry: lo > seaLevel + TOWN_ABOVE_SEA_UNITS, channel };
}

/** Layout u,v for the storm challenge's town (the map centre when nothing near it is dry land). */
export function stormTownSpot(heights: Float32Array, grid: GridSize, seaLevel: number): { u: number; v: number } {
  const { width, height } = grid;
  const acc = flowAccumulation(heights, grid);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  // Strictest first: flat floodplain off the channels, then any dry ground off them, then any dry ground at all.
  const rules: ((p: Patch) => boolean)[] = [
    (p) => p.dry && !p.channel && p.span <= MAX_PATCH_SPAN_UNITS,
    (p) => p.dry && !p.channel,
    (p) => p.dry,
  ];
  for (const accept of rules) {
    for (const radius of SEARCH_RADII) {
      const r = radius * (width - 1);
      let best: { x: number; y: number; score: number } | null = null;
      for (let y = Math.max(2, Math.ceil(cy - r)); y <= Math.min(height - 3, Math.floor(cy + r)); y++) {
        for (let x = Math.max(2, Math.ceil(cx - r)); x <= Math.min(width - 3, Math.floor(cx + r)); x++) {
          const dist = Math.hypot(x - cx, y - cy);
          if (dist > r) continue;
          const patch = patchAt(heights, acc, width, x, y, seaLevel);
          // Lowest ground wins (water gathers there); ties go to the cell nearest where the player asked.
          const score = patch.mean + dist * 1e-3;
          if (accept(patch) && (!best || score < best.score)) best = { x, y, score };
        }
      }
      if (best) return { u: best.x / (width - 1), v: best.y / (height - 1) };
    }
  }
  return { u: 0.5, v: 0.5 };
}
