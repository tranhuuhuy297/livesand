// Fetches the Terrarium tiles around a place and resamples them to grid meters. The PNG decoder is injected so the
// same pipeline runs in the browser (createImageBitmap + OffscreenCanvas) and in Node (pngjs, bake script and tests).
import type { GridSize } from '../core/types';
import {
  assertValidPlaceFrame,
  chooseTileZoom,
  placeMercatorBox,
  resampleMosaicToGrid,
  stitchTiles,
  tilesCoveringBox,
  type PlaceFrame,
  type TileCoord,
} from './place-terrain-resampling';
import { removeElevationSpikes } from './real-place-elevation-cleanup';
import { TERRARIUM_TILE_SIZE, decodeTerrariumRgba, terrariumTileUrl } from './terrarium-decoding';

export interface DecodedRgbaImage {
  rgba: ArrayLike<number>;
  width: number;
  height: number;
}

export type PngRgbaDecoder = (png: ArrayBuffer) => Promise<DecodedRgbaImage>;

export interface PlaceMetersResult {
  meters: Float32Array;
  zoom: number;
  tiles: TileCoord[];
}

/** Browser PNG decode; colour management and premultiplication off so the RGB bytes stay exact elevation codes. */
export async function decodePngWithCanvas(png: ArrayBuffer): Promise<DecodedRgbaImage> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    throw new Error('Decoding terrain tiles needs createImageBitmap and OffscreenCanvas (use a current browser)');
  }
  const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');
    ctx.drawImage(bitmap, 0, 0);
    const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { rgba: image.data, width: image.width, height: image.height };
  } finally {
    bitmap.close();
  }
}

async function fetchTileMeters(tile: TileCoord, fetchImpl: typeof fetch, decode: PngRgbaDecoder): Promise<Float32Array> {
  const url = terrariumTileUrl(tile.z, tile.x, tile.y);
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch (err) {
    throw new Error(`Could not download terrain tile ${tile.z}/${tile.x}/${tile.y}: ${(err as Error).message}`);
  }
  if (!res.ok) throw new Error(`Terrain tile ${tile.z}/${tile.x}/${tile.y} failed: HTTP ${res.status}`);
  const image = await decode(await res.arrayBuffer());
  if (image.width !== TERRARIUM_TILE_SIZE || image.height !== TERRARIUM_TILE_SIZE) {
    throw new Error(`Terrain tile ${tile.z}/${tile.x}/${tile.y} is ${image.width}x${image.height}, expected ${TERRARIUM_TILE_SIZE}px`);
  }
  return decodeTerrariumRgba(image.rgba, image.width, image.height);
}

/** Despiked elevation in meters per grid cell for a place frame centred on (lat, lon), widthKm across the grid. */
export async function fetchPlaceMeters(
  frame: PlaceFrame,
  grid: GridSize,
  fetchImpl: typeof fetch,
  decode: PngRgbaDecoder,
): Promise<PlaceMetersResult> {
  assertValidPlaceFrame(frame);
  if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 2 || grid.height < 2) {
    throw new RangeError(`Invalid grid size ${grid.width}x${grid.height}`);
  }
  const zoom = chooseTileZoom(frame, grid);
  const box = placeMercatorBox(frame, grid, zoom);
  const cover = tilesCoveringBox(box);
  const tileMeters = await Promise.all(cover.tiles.map((t) => fetchTileMeters(t, fetchImpl, decode)));
  const mosaic = stitchTiles(tileMeters, cover.columns, cover.rows, cover.originX, cover.originY);
  const meters = resampleMosaicToGrid(mosaic, box, grid);
  removeElevationSpikes(meters, grid);
  return { meters, zoom, tiles: cover.tiles };
}
