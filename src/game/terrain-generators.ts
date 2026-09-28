// Deterministic procedural terrains (heights in world units = grid cells) built from hand-designed layouts + seeded fBm.
import type { GridSize } from '../core/types';
import { ValueNoise2D } from './seeded-value-noise';
import { TERRAIN_LAYOUTS } from './terrain-layouts';
import { applyTerrainOp } from './terrain-shaping-primitives';

export type TerrainKind = 'river-valley' | 'twin-valleys' | 'mountain-basin' | 'flat';

export interface TerrainRecipe {
  kind: TerrainKind;
  seed: number;
  /** Maximum height in world units; defaults to defaultRelief(grid). */
  relief?: number;
}

/** Relief of the 256-cell-wide reference grid. */
export const REFERENCE_RELIEF = 30;
export const REFERENCE_GRID_WIDTH = 256;

// Noise lattice cells across the grid width (largest bumps ~50 cells on the reference grid).
const NOISE_FREQUENCY = 5;
const NOISE_OCTAVES = 5;

/** Relief scaled with grid width so slopes per cell (and therefore water speed) match the reference grid. */
export function defaultRelief(grid: GridSize): number {
  return (REFERENCE_RELIEF * grid.width) / REFERENCE_GRID_WIDTH;
}

export function assertValidGrid(grid: GridSize): void {
  const ok = (n: number) => Number.isInteger(n) && n > 0;
  if (!ok(grid.width) || !ok(grid.height)) {
    throw new RangeError(`Invalid grid size ${grid.width}x${grid.height}: expected positive integers`);
  }
}

/** Normalised layout coordinate of a cell centre (0 at the first cell, 1 at the last). */
export function cellToLayout(cell: number, cells: number): number {
  return cells > 1 ? cell / (cells - 1) : 0.5;
}

/** Inverse of cellToLayout: layout coordinate -> fractional cell coordinate. */
export function layoutToCell(t: number, cells: number): number {
  return cells > 1 ? t * (cells - 1) : 0;
}

export function generateTerrain(grid: GridSize, recipe: TerrainRecipe): Float32Array {
  assertValidGrid(grid);
  const layout = TERRAIN_LAYOUTS[recipe.kind];
  if (!layout) throw new Error(`Unknown terrain kind: ${String(recipe.kind)}`);
  const relief = recipe.relief ?? defaultRelief(grid);
  if (!Number.isFinite(relief) || relief < 0) throw new RangeError(`Invalid relief: ${relief}`);
  if (!Number.isFinite(recipe.seed)) throw new RangeError(`Invalid seed: ${recipe.seed}`);

  const { width, height } = grid;
  const aspect = width > 1 && height > 1 ? (height - 1) / (width - 1) : 1;
  const noise = new ValueNoise2D(recipe.seed);
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const v = cellToLayout(y, height);
    for (let x = 0; x < width; x++) {
      const u = cellToLayout(x, width);
      const base = layout.base(u, v);
      const amp = layout.noiseAmplitude(base);
      let h = amp > 0 ? base + amp * noise.fbm(u * NOISE_FREQUENCY, v * aspect * NOISE_FREQUENCY, NOISE_OCTAVES) : base;
      for (const op of layout.ops) h = applyTerrainOp(h, u, v, aspect, op);
      out[y * width + x] = Math.min(1, Math.max(0, h)) * relief;
    }
  }
  return out;
}
