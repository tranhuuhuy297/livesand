// Tells a real coast from land below sea level. Terrain tiles store the sea either as a 0 m plateau (SRTM water) or as
// smooth bathymetry, while basins below sea level (Death Valley, the Dead Sea, Qattara, polders) are dry land or
// lakes with their own flat surface, so "everything at or below 0 m" alone would paint them as ocean.
import type { GridSize } from '../core/types';

/** Fewer border-connected sea-level cells than this share of the map are river pixels or data voids, not a coast. */
export const COASTAL_CELL_FRACTION = 0.002;
// DEM water flattened to sea level reads within this of 0 m.
const SEA_SURFACE_METERS = 1;
// A region mostly at 0 m is the sea surface itself.
const SEA_SURFACE_SHARE = 0.5;
// Below sea level, lakes (the Dead Sea, Salton Sea) are exactly flat over this share of the region...
const LAKE_SURFACE_SHARE = 0.15;
const LAKE_BIN_METERS = 0.05;
// ...polders and playas are nearly flat (1 m bins) yet rougher than the smooth, interpolated floor of a shallow sea...
const FLAT_FLOOR_SHARE = 0.15;
const FLAT_FLOOR_MIN_ROUGHNESS_METERS = 0.2;
// ...and slopes of dry land are rougher than any bathymetry.
const LAND_ROUGHNESS_METERS = 0.8;
const BELOW_SEA_METERS = -1.5;

/** Cells at or below `waterMaxMeters` connected (4-way) to the map border. */
export function borderConnectedLowCells(meters: Float32Array, grid: GridSize, waterMaxMeters: number): number[] {
  const { width, height } = grid;
  const seen = new Uint8Array(meters.length);
  const stack: number[] = [];
  const region: number[] = [];
  const seed = (i: number): void => {
    if (!seen[i] && meters[i] <= waterMaxMeters) {
      seen[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  while (stack.length > 0) {
    const i = stack.pop()!;
    region.push(i);
    const x = i % width;
    if (x > 0) seed(i - 1);
    if (x < width - 1) seed(i + 1);
    if (i >= width) seed(i - width);
    if (i < meters.length - width) seed(i + width);
  }
  return region;
}

/** Share of the region in its most common `binMeters` band below BELOW_SEA_METERS (a lake, playa or polder floor). */
function floorShare(meters: Float32Array, region: number[], binMeters: number): number {
  const bins = new Map<number, number>();
  let best = 0;
  for (const i of region) {
    if (meters[i] >= BELOW_SEA_METERS) continue;
    const bin = Math.round(meters[i] / binMeters);
    const n = (bins.get(bin) ?? 0) + 1;
    bins.set(bin, n);
    best = Math.max(best, n);
  }
  return best / region.length;
}

/** Median |4-neighbour Laplacian| (m) over the region's interior cells: bathymetry is smooth, basin floors are not. */
function medianRoughness(meters: Float32Array, grid: GridSize, region: number[]): number {
  const { width, height } = grid;
  const values: number[] = [];
  for (const i of region) {
    const x = i % width;
    const y = (i - x) / width;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) continue;
    values.push(Math.abs(meters[i - 1] + meters[i + 1] + meters[i - width] + meters[i + width] - 4 * meters[i]));
  }
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  return values[values.length >> 1];
}

/** Whether the map's border-connected low ground is open sea (true) or land/lakes below sea level (false). */
export function hasOpenSea(meters: Float32Array, grid: GridSize, waterMaxMeters: number): boolean {
  const region = borderConnectedLowCells(meters, grid, waterMaxMeters);
  if (region.length === 0 || region.length < COASTAL_CELL_FRACTION * meters.length) return false;
  let surface = 0;
  for (const i of region) if (Math.abs(meters[i]) <= SEA_SURFACE_METERS) surface++;
  if (surface >= SEA_SURFACE_SHARE * region.length) return true;
  if (floorShare(meters, region, LAKE_BIN_METERS) >= LAKE_SURFACE_SHARE) return false;
  const roughness = medianRoughness(meters, grid, region);
  if (roughness >= LAND_ROUGHNESS_METERS) return false;
  return !(floorShare(meters, region, 1) >= FLAT_FLOOR_SHARE && roughness >= FLAT_FLOOR_MIN_ROUGHNESS_METERS);
}
