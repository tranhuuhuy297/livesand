// Real-world terrain maps: baked places shipped in public/places/ and live AWS Terrain Tiles for any lat/lon.
import type { GridSize } from '../core/types';
import { lonToGlobalPixelX, latToGlobalPixelY, placeMercatorBox, placeMetersPerCell, resampleGrid, type PlaceFrame } from './place-terrain-resampling';
import { TERRAIN_ATTRIBUTION, attributionForSourceFlags } from './real-place-attribution';
import { BakedPlaceFormatError, decodeBakedPlace, type BakedPlaceData } from './real-place-baked-format';
import { mapPlaceHeights, type PlaceTerrain } from './real-place-height-mapping';
import { decodePngWithCanvas, fetchPlaceMeters, type PngRgbaDecoder } from './real-place-tile-fetching';
import { findRealPlace } from './real-places-catalog';
import { TERRARIUM_TILE_SIZE } from './terrarium-decoding';

export { REAL_PLACES, findRealPlace, type RealPlace } from './real-places-catalog';
export { TERRAIN_ATTRIBUTION } from './real-place-attribution';
export { decodeTerrariumMeters } from './terrarium-decoding';
export type { PlaceTerrain } from './real-place-height-mapping';

const defaultFetch: typeof fetch = (input, init) => fetch(input, init);

function assertGrid(grid: GridSize): void {
  if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 2 || grid.height < 2) {
    throw new RangeError(`Invalid grid size ${grid.width}x${grid.height}`);
  }
}

/** URL of a baked place, relative to the page so it also works under the GitHub Pages subpath. */
export function bakedPlaceUrl(id: string): string {
  return `./places/${encodeURIComponent(id)}.bin`;
}

/** Loads a baked place (one fetch), resampling to `grid` when it differs from the baked 256x192. */
export async function loadBakedPlace(id: string, grid: GridSize, fetchImpl: typeof fetch = defaultFetch): Promise<PlaceTerrain> {
  const place = findRealPlace(id);
  if (!place) throw new Error(`Unknown place "${id}"`);
  assertGrid(grid);
  let res: Response;
  try {
    res = await fetchImpl(bakedPlaceUrl(id));
  } catch (err) {
    throw new Error(`Could not download map "${place.name}": ${(err as Error).message}`);
  }
  if (!res.ok) throw new Error(`Could not download map "${place.name}": HTTP ${res.status}`);
  let baked: BakedPlaceData;
  try {
    baked = decodeBakedPlace(await res.arrayBuffer());
  } catch (err) {
    if (err instanceof BakedPlaceFormatError) throw new Error(`Map "${place.name}" is corrupt: ${err.message}`);
    throw err;
  }
  return mapPlaceHeights({
    meters: resampleGrid(baked.meters, { width: baked.width, height: baked.height }, grid),
    grid,
    metersPerCell: placeMetersPerCell(place, grid),
    verticalExaggeration: place.verticalExaggeration,
    attribution: attributionForSourceFlags(baked.sourceFlags),
  });
}

/** Same as loadLivePlace with an explicit PNG decoder (Node has no createImageBitmap). */
export async function loadLivePlaceWithDecoder(
  frame: PlaceFrame & { verticalExaggeration?: number },
  grid: GridSize,
  fetchImpl: typeof fetch,
  decode: PngRgbaDecoder,
): Promise<PlaceTerrain> {
  assertGrid(grid);
  const { meters } = await fetchPlaceMeters(frame, grid, fetchImpl, decode);
  return mapPlaceHeights({
    meters,
    grid,
    metersPerCell: placeMetersPerCell(frame, grid),
    verticalExaggeration: frame.verticalExaggeration,
    attribution: TERRAIN_ATTRIBUTION,
  });
}

/** Any place on Earth from live AWS Terrain Tiles (Terrarium PNGs, CORS-enabled). */
export async function loadLivePlace(lat: number, lon: number, widthKm: number, grid: GridSize, fetchImpl: typeof fetch = defaultFetch): Promise<PlaceTerrain> {
  return loadLivePlaceWithDecoder({ lat, lon, widthKm }, grid, fetchImpl, decodePngWithCanvas);
}

/** Normalised grid position (u,v in 0..1 when inside, north = v 0) of a lat/lon, e.g. to put villages on landmarks. */
export function placeUV(place: PlaceFrame, grid: GridSize, lat: number, lon: number): { u: number; v: number } {
  // Zoom 0 in floating point: the ratio is zoom-independent, so this matches the baked/live framing exactly.
  const box = placeMercatorBox(place, grid, 0);
  const worldWidth = TERRARIUM_TILE_SIZE;
  let dx = lonToGlobalPixelX(lon, 0) - (box.left + box.width / 2);
  // Take the short way round the antimeridian.
  if (dx > worldWidth / 2) dx -= worldWidth;
  if (dx < -worldWidth / 2) dx += worldWidth;
  return { u: 0.5 + dx / box.width, v: (latToGlobalPixelY(lat, 0) - box.top) / box.height };
}
