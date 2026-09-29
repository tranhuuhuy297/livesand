// D8 flow routing over a heightfield: where rain on each cell runs (steepest descent), how much drains through each
// cell, and a prefill that pours a catchment's rain straight into its rivers so they fill without a film everywhere.
import type { GridSize } from '../core/types';
import { priorityFlood } from './real-place-hollow-filling';

export interface FlowRouting {
  /** Downhill neighbour of each cell (steepest descent over the 8 neighbours), or -1 at the map's outlets. */
  receivers: Int32Array;
  /** 1 where the ground actually slopes down to the receiver, 0 on flats and pits (routed along the flood instead). */
  sloped: Uint8Array;
  /** Cells ordered so every cell comes before its receiver. */
  order: Int32Array;
}

/**
 * Steepest descent where the ground slopes; across flats and pits (a flat delta, a lake surface) the path the priority
 * flood took from the outlets, so every river runs on to the border or the sea.
 */
export function d8Routing(heights: Float32Array, grid: GridSize): FlowRouting {
  const { width, height } = grid;
  const n = heights.length;
  const receivers = new Int32Array(n).fill(-1);
  const sloped = new Uint8Array(n);
  const floodOrder: number[] = [];
  const floodFrom = new Int32Array(n);
  priorityFlood(heights, grid, -Infinity, (cell, from) => {
    floodOrder.push(cell);
    floodFrom[cell] = from;
  });
  for (let i = 0; i < n; i++) {
    const x = i % width;
    const y = (i - x) / width;
    let drop = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        const d = (heights[i] - heights[j]) / Math.hypot(dx, dy);
        if (d > drop) {
          drop = d;
          receivers[i] = j;
        }
      }
    }
    sloped[i] = receivers[i] >= 0 ? 1 : 0;
    if (receivers[i] < 0) receivers[i] = floodFrom[i];
  }
  // Reverse flood order puts every cell before the one it drains to, flats included (heights alone cannot order those).
  const order = Int32Array.from(orderDownstream(receivers, floodOrder));
  return { receivers, order, sloped };
}

/** Topological order (upstream first) of the drainage tree; `floodOrder` breaks ties so flats follow the flood. */
function orderDownstream(receivers: Int32Array, floodOrder: number[]): number[] {
  const n = receivers.length;
  const inflow = new Int32Array(n);
  for (let i = 0; i < n; i++) if (receivers[i] >= 0) inflow[receivers[i]]++;
  const ready = floodOrder.filter((i) => inflow[i] === 0).reverse();
  const order: number[] = [];
  while (ready.length > 0) {
    const i = ready.pop()!;
    order.push(i);
    const next = receivers[i];
    if (next >= 0 && --inflow[next] === 0) ready.push(next);
  }
  return order;
}

/** Cells (itself included) whose steepest-descent path passes through each cell. */
export function flowAccumulation(heights: Float32Array, grid: GridSize, routing = d8Routing(heights, grid)): Float32Array {
  const acc = new Float32Array(heights.length).fill(1);
  for (const i of routing.order) if (routing.receivers[i] >= 0) acc[routing.receivers[i]] += acc[i];
  return acc;
}

/**
 * Per-cell emission (units/s) that delivers `rainPerCell` falling on sloping ground into the first river cell (draining
 * at least `channelShare` of the map) downhill of it. Rivers and the lakes they feed fill; hillslopes stay dry instead
 * of wearing a film of rain water, and rain on flat plains soaks in (it would only spread into a sheet there).
 */
export function riverPrefillEmission(heights: Float32Array, grid: GridSize, rainPerCell: number, channelShare = 0.002): Float32Array {
  const routing = d8Routing(heights, grid);
  const acc = flowAccumulation(heights, grid, routing);
  const channel = Math.max(2, channelShare * heights.length);
  const carried = new Float32Array(heights.length);
  const out = new Float32Array(heights.length);
  if (!(rainPerCell > 0)) return out;
  for (const i of routing.order) {
    const water = carried[i] + (routing.sloped[i] ? rainPerCell : 0);
    const next = routing.receivers[i];
    if (acc[i] >= channel) out[i] = water;
    else if (next >= 0) carried[next] += water;
  }
  return out;
}
