// Village ground can be built up but never dug away: a channel dug through a village would only sink its houses.
import type { GridSize } from '../core/types';

export interface FloorVillage {
  x: number;
  y: number;
  radius: number;
}

/** Per-cell dig floor: the loaded height inside each village disc (plus `margin` cells), -Infinity elsewhere. */
export function buildVillageSculptFloor(
  heights: Float32Array,
  grid: GridSize,
  villages: readonly FloorVillage[],
  margin = 1,
): Float32Array | null {
  if (villages.length === 0) return null;
  const { width, height } = grid;
  const floor = new Float32Array(width * height).fill(-Infinity);
  for (const v of villages) {
    const r = Math.max(0, v.radius) + margin;
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(r)) continue;
    for (let y = Math.max(0, Math.ceil(v.y - r)); y <= Math.min(height - 1, Math.floor(v.y + r)); y++) {
      for (let x = Math.max(0, Math.ceil(v.x - r)); x <= Math.min(width - 1, Math.floor(v.x + r)); x++) {
        if (Math.hypot(x - v.x, y - v.y) <= r) floor[y * width + x] = heights[y * width + x];
      }
    }
  }
  return floor;
}
