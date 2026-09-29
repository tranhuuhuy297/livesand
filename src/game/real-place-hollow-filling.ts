// Fills shallow closed hollows in a DEM (priority flood from the map border and the sea), so rain on real maps runs
// off along the valleys instead of beading into thousands of puddles in tree/building noise. Deep hollows (crater
// lakes, quarries) are kept.
import type { GridSize } from '../core/types';

/** Binary min-heap of cell indices keyed by their spill level. */
class LevelHeap {
  private keys: Float64Array;
  private cells: Int32Array;
  size = 0;

  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
    this.cells = new Int32Array(capacity);
  }

  push(key: number, cell: number): void {
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.keys[i] = this.keys[parent];
      this.cells[i] = this.cells[parent];
      i = parent;
    }
    this.keys[i] = key;
    this.cells[i] = cell;
  }

  pop(): number {
    const top = this.cells[0];
    const key = this.keys[--this.size];
    const cell = this.cells[this.size];
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= this.size) break;
      if (child + 1 < this.size && this.keys[child + 1] < this.keys[child]) child++;
      if (this.keys[child] >= key) break;
      this.keys[i] = this.keys[child];
      this.cells[i] = this.cells[child];
      i = child;
    }
    this.keys[i] = key;
    this.cells[i] = cell;
    return top;
  }
}

function forEachNeighbour(i: number, width: number, count: number, fn: (j: number) => void): void {
  const x = i % width;
  if (x > 0) fn(i - 1);
  if (x < width - 1) fn(i + 1);
  if (i >= width) fn(i - width);
  if (i < count - width) fn(i + width);
}

/**
 * Priority flood: visits every cell from the outlets (the map border and cells at or below `seaMax`) inward, lowest
 * spill level first. `visit(cell, from, level)` gets the cell it was reached from (-1 for outlets) and its spill level.
 */
export function priorityFlood(heights: Float32Array, grid: GridSize, seaMax: number, visit: (cell: number, from: number, level: number) => void): void {
  const { width, height } = grid;
  const n = heights.length;
  const level = new Float32Array(n);
  const done = new Uint8Array(n);
  const heap = new LevelHeap(n);
  for (let i = 0; i < n; i++) {
    const x = i % width;
    const y = (i - x) / width;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1 || heights[i] <= seaMax) {
      done[i] = 1;
      level[i] = heights[i];
      heap.push(heights[i], i);
      visit(i, -1, heights[i]);
    }
  }
  while (heap.size > 0) {
    const i = heap.pop();
    forEachNeighbour(i, width, n, (j) => {
      if (done[j]) return;
      done[j] = 1;
      level[j] = Math.max(heights[j], level[i]);
      heap.push(level[j], j);
      visit(j, i, level[j]);
    });
  }
}

/** Lowest level water in each cell must rise to before it can spill to the border or to a sea cell (<= seaMaxMeters). */
export function spillLevels(meters: Float32Array, grid: GridSize, seaMaxMeters: number): Float32Array {
  const spill = new Float32Array(meters.length);
  priorityFlood(meters, grid, seaMaxMeters, (cell, _from, level) => (spill[cell] = level));
  return spill;
}

/** Raises every closed hollow no deeper than `maxDepthMeters` to its spill level; returns a new array. */
export function fillShallowHollows(meters: Float32Array, grid: GridSize, maxDepthMeters: number, seaMaxMeters: number): Float32Array {
  const out = meters.slice();
  if (!(maxDepthMeters > 0)) return out;
  const spill = spillLevels(meters, grid, seaMaxMeters);
  const n = meters.length;
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  for (let start = 0; start < n; start++) {
    if (seen[start] || spill[start] <= meters[start]) continue;
    const hollow: number[] = [];
    let deepest = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      hollow.push(i);
      deepest = Math.max(deepest, spill[i] - meters[i]);
      forEachNeighbour(i, grid.width, n, (j) => {
        if (!seen[j] && spill[j] > meters[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      });
    }
    if (deepest <= maxDepthMeters) for (const i of hollow) out[i] = spill[i];
  }
  return out;
}
