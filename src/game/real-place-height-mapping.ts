// Maps real elevations (meters) to sandbox heights (world units). The sculpt floor is 0; land starts LAND_BASE_UNITS
// above it so players can still dig. Coastal maps put sea level (0 m) at LAND_BASE_UNITS with the sea floor between.
import type { EdgeFlags, GridSize } from '../core/types';
import { fillInlandSeaSpecks, smoothLandElevation } from './real-place-elevation-cleanup';
import { fillShallowHollows } from './real-place-hollow-filling';
import { hasOpenSea } from './real-place-sea-detection';

export interface PlaceTerrain {
  /** World units, grid-sized; sea level maps to seaLevel. */
  heights: Float32Array;
  /** World units; cells below it are ocean (0 on inland maps, so nothing reads as sea). */
  seaLevel: number;
  minHeight: number;
  maxHeight: number;
  /** Coastal maps: open where the border touches ocean. Inland maps: all open, so rivers leave the frame. */
  openEdges: EdgeFlags;
  metersPerUnitVertical: number;
  metersPerCell: number;
  attribution: string;
}

export const LAND_BASE_UNITS = 2;
/** Same relief as the procedural levels, so water speeds and colormaps feel alike. */
export const TARGET_LAND_RELIEF_UNITS = 30;
export const MIN_AUTO_EXAGGERATION = 0.5;
export const MAX_AUTO_EXAGGERATION = 25;
// SRTM/GMTED store water as exactly 0 m; the tolerance absorbs baked-file quantization of that plateau.
const OCEAN_MAX_METERS = 0.1;
// Ocean sits at least this far below sea level so coastlines stay crisp after bilinear blending.
const SHORE_DROP_UNITS = 0.5;
const OPEN_EDGE_OCEAN_FRACTION = 0.05;
// Inland sea-level patches smaller than this are ponds or data holes, not sea.
const MIN_SEA_COMPONENT_CELLS = 24;
// SRTM canopy/building noise; smoothed away once it would exceed about a third of a world unit.
const DEM_NOISE_METERS = 3;
/** Closed hollows up to this deep (world units) are filled, so rain runs off instead of beading in DEM noise. */
export const HOLLOW_FILL_UNITS = 1;
const ALL_EDGES_OPEN: EdgeFlags = { north: true, east: true, south: true, west: true };

/** Land blur passes that keep DEM noise below ~0.3 world units at this vertical scale (3D shows flat deltas taller). */
export function noiseSmoothingPasses(metersPerUnitVertical: number): number {
  const noiseUnits = DEM_NOISE_METERS / metersPerUnitVertical;
  return noiseUnits > 0.8 ? 4 : noiseUnits > 0.3 ? 2 : 0;
}

export interface PlaceHeightMappingInput {
  meters: Float32Array;
  grid: GridSize;
  metersPerCell: number;
  /** Vertical scale relative to horizontal; automatic when omitted. */
  verticalExaggeration?: number;
  attribution: string;
}

export function autoVerticalExaggeration(landReliefMeters: number, metersPerCell: number): number {
  const ideal = landReliefMeters > 0 ? (metersPerCell * TARGET_LAND_RELIEF_UNITS) / landReliefMeters : MAX_AUTO_EXAGGERATION;
  return Math.max(MIN_AUTO_EXAGGERATION, Math.min(MAX_AUTO_EXAGGERATION, ideal));
}

/** Open edges wherever enough border cells lie below sea level. */
export function oceanOpenEdges(heights: Float32Array, grid: GridSize, seaLevel: number): EdgeFlags {
  const { width, height } = grid;
  const isOpen = (cells: number[]): boolean => {
    const ocean = cells.reduce((n, i) => n + (heights[i] < seaLevel ? 1 : 0), 0);
    return ocean >= Math.max(2, OPEN_EDGE_OCEAN_FRACTION * cells.length);
  };
  const row = (y: number) => Array.from({ length: width }, (_, x) => y * width + x);
  const col = (x: number) => Array.from({ length: height }, (_, y) => y * width + x);
  return { north: isOpen(row(0)), east: isOpen(col(width - 1)), south: isOpen(row(height - 1)), west: isOpen(col(0)) };
}

export function mapPlaceHeights(input: PlaceHeightMappingInput): PlaceTerrain {
  const { meters, grid, metersPerCell } = input;
  if (meters.length !== grid.width * grid.height) throw new RangeError(`Expected ${grid.width * grid.height} heights, got ${meters.length}`);
  if (!(metersPerCell > 0) || !Number.isFinite(metersPerCell)) throw new RangeError(`Invalid meters per cell: ${metersPerCell}`);
  const override = input.verticalExaggeration;
  if (override !== undefined && !(override > 0 && Number.isFinite(override))) throw new RangeError(`Invalid vertical exaggeration: ${override}`);

  let minM = Infinity;
  let maxM = -Infinity;
  for (const m of meters) {
    if (!Number.isFinite(m)) throw new RangeError('Elevation data contains non-finite values');
    minM = Math.min(minM, m);
    maxM = Math.max(maxM, m);
  }
  // Land below sea level (Death Valley, the Dead Sea, polders) keeps its relief instead of turning into painted sea.
  const coastal = hasOpenSea(meters, grid, OCEAN_MAX_METERS);
  const exaggeration = override ?? autoVerticalExaggeration(Math.max(0, maxM - (coastal ? 0 : minM)), metersPerCell);
  const metersPerUnitVertical = metersPerCell / exaggeration;
  const seaLevel = coastal ? LAND_BASE_UNITS : 0;
  const passes = noiseSmoothingPasses(metersPerUnitVertical);
  const cleaned = coastal ? fillInlandSeaSpecks(meters, grid, OCEAN_MAX_METERS, MIN_SEA_COMPONENT_CELLS) : meters;
  const waterMax = coastal ? OCEAN_MAX_METERS : -Infinity;
  const smoothed = passes > 0 ? smoothLandElevation(cleaned, grid, passes, waterMax) : cleaned;
  const drained = fillShallowHollows(smoothed, grid, HOLLOW_FILL_UNITS * metersPerUnitVertical, waterMax);
  // Inland maps start at their lowest cell after cleanup, so the sculpt floor stays LAND_BASE_UNITS below it.
  const baseMeters = coastal ? 0 : drained.reduce((lo, m) => Math.min(lo, m), Infinity);

  const heights = new Float32Array(meters.length);
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  for (let i = 0; i < meters.length; i++) {
    const m = drained[i];
    const h =
      coastal && m <= OCEAN_MAX_METERS
        ? Math.max(0, Math.min(seaLevel - SHORE_DROP_UNITS, seaLevel + m / metersPerUnitVertical))
        : LAND_BASE_UNITS + (m - baseMeters) / metersPerUnitVertical;
    heights[i] = h;
    // Report the stored f32 values so min/max match the array exactly.
    minHeight = Math.min(minHeight, heights[i]);
    maxHeight = Math.max(maxHeight, heights[i]);
  }
  return {
    heights,
    seaLevel,
    minHeight,
    maxHeight,
    openEdges: coastal ? oceanOpenEdges(heights, grid, seaLevel) : { ...ALL_EDGES_OPEN },
    metersPerUnitVertical,
    metersPerCell,
    attribution: input.attribution,
  };
}
