// Web-Mercator framing of a real place onto the sim grid: zoom choice, tile coverage, mosaic stitching and bilinear
// resampling. Cell (x, y) samples the place at u = x / (width - 1), v = y / (height - 1), like layoutToCell.
import type { GridSize } from '../core/types';
import { TERRARIUM_TILE_SIZE } from './terrarium-decoding';

export interface PlaceFrame {
  lat: number;
  lon: number;
  widthKm: number;
}

/** Axis-aligned Web-Mercator box in global pixel coordinates at `zoom` (256 px tiles, y down). */
export interface MercatorBox {
  zoom: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

/** A stitched block of tiles: meters per pixel, row-major; origin = global pixel coords of its top-left corner. */
export interface ElevationMosaic {
  meters: Float32Array;
  width: number;
  height: number;
  originX: number;
  originY: number;
}

const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6378137;
const MAX_MERCATOR_LAT = 85.05112878;
export const MAX_TERRARIUM_ZOOM = 15;

export function assertValidPlaceFrame(frame: PlaceFrame): void {
  if (!Number.isFinite(frame.lat) || Math.abs(frame.lat) > 80) throw new RangeError(`Latitude out of range: ${frame.lat}`);
  if (!Number.isFinite(frame.lon) || Math.abs(frame.lon) > 180) throw new RangeError(`Longitude out of range: ${frame.lon}`);
  if (!Number.isFinite(frame.widthKm) || frame.widthKm < 0.5 || frame.widthKm > 1000) {
    throw new RangeError(`Place width must be 0.5..1000 km, got ${frame.widthKm}`);
  }
}

export function lonToGlobalPixelX(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * TERRARIUM_TILE_SIZE * 2 ** zoom;
}

export function latToGlobalPixelY(lat: number, zoom: number): number {
  const phi = (Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * TERRARIUM_TILE_SIZE * 2 ** zoom;
}

export function globalPixelYToLat(py: number, zoom: number): number {
  const n = Math.PI * (1 - (2 * py) / (TERRARIUM_TILE_SIZE * 2 ** zoom));
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

export function globalPixelXToLon(px: number, zoom: number): number {
  return (px / (TERRARIUM_TILE_SIZE * 2 ** zoom)) * 360 - 180;
}

/** Ground meters per Web-Mercator pixel at a latitude. */
export function metersPerMercatorPixel(lat: number, zoom: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / (TERRARIUM_TILE_SIZE * 2 ** zoom);
}

/** Ground meters between neighbouring cell centres when the place spans the grid width. */
export function placeMetersPerCell(frame: PlaceFrame, grid: GridSize): number {
  return (frame.widthKm * 1000) / Math.max(1, grid.width - 1);
}

/** Lowest zoom whose pixels are at least as fine as the grid cells (so the resample never upsamples). */
export function chooseTileZoom(frame: PlaceFrame, grid: GridSize): number {
  const ratio = metersPerMercatorPixel(frame.lat, 0) / placeMetersPerCell(frame, grid);
  return Math.max(0, Math.min(MAX_TERRARIUM_ZOOM, Math.ceil(Math.log2(ratio))));
}

/** Box centred on the place, widthKm wide, height following the grid aspect so cells stay square. */
export function placeMercatorBox(frame: PlaceFrame, grid: GridSize, zoom: number): MercatorBox {
  const width = (frame.widthKm * 1000) / metersPerMercatorPixel(frame.lat, zoom);
  const height = grid.width > 1 ? (width * (grid.height - 1)) / (grid.width - 1) : width;
  const cx = lonToGlobalPixelX(frame.lon, zoom);
  const cy = latToGlobalPixelY(frame.lat, zoom);
  return { zoom, left: cx - width / 2, top: cy - height / 2, width, height };
}

/** Tiles covering the box plus a one-pixel apron for bilinear neighbours, row-major from the top-left tile. */
export function tilesCoveringBox(box: MercatorBox): { tiles: TileCoord[]; columns: number; rows: number; originX: number; originY: number } {
  const n = 2 ** box.zoom;
  const tx0 = Math.floor((box.left - 1) / TERRARIUM_TILE_SIZE);
  const tx1 = Math.floor((box.left + box.width + 1) / TERRARIUM_TILE_SIZE);
  const ty0 = Math.max(0, Math.floor((box.top - 1) / TERRARIUM_TILE_SIZE));
  const ty1 = Math.min(n - 1, Math.floor((box.top + box.height + 1) / TERRARIUM_TILE_SIZE));
  const tiles: TileCoord[] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    // Wrap x across the antimeridian; y is clamped because the Mercator world does not wrap vertically.
    for (let tx = tx0; tx <= tx1; tx++) tiles.push({ z: box.zoom, x: ((tx % n) + n) % n, y: ty });
  }
  return {
    tiles,
    columns: tx1 - tx0 + 1,
    rows: ty1 - ty0 + 1,
    originX: tx0 * TERRARIUM_TILE_SIZE,
    originY: ty0 * TERRARIUM_TILE_SIZE,
  };
}

/** Stitches decoded tiles (meters, TERRARIUM_TILE_SIZE squared, in tilesCoveringBox order) into one mosaic. */
export function stitchTiles(tileMeters: Float32Array[], columns: number, rows: number, originX: number, originY: number): ElevationMosaic {
  const size = TERRARIUM_TILE_SIZE;
  if (tileMeters.length !== columns * rows) throw new RangeError(`Expected ${columns * rows} tiles, got ${tileMeters.length}`);
  const width = columns * size;
  const height = rows * size;
  const meters = new Float32Array(width * height);
  tileMeters.forEach((tile, i) => {
    if (tile.length !== size * size) throw new RangeError(`Tile ${i} has ${tile.length} pixels, expected ${size * size}`);
    const ox = (i % columns) * size;
    const oy = Math.floor(i / columns) * size;
    for (let row = 0; row < size; row++) meters.set(tile.subarray(row * size, (row + 1) * size), (oy + row) * width + ox);
  });
  return { meters, width, height, originX, originY };
}

/** Bilinear sample at a fractional pixel position (pixel centres at integer coords), clamped at the borders. */
export function sampleBilinear(values: Float32Array, width: number, height: number, fx: number, fy: number): number {
  const x = Math.max(0, Math.min(width - 1, fx));
  const y = Math.max(0, Math.min(height - 1, fy));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const top = values[y0 * width + x0] * (1 - tx) + values[y0 * width + x1] * tx;
  const bottom = values[y1 * width + x0] * (1 - tx) + values[y1 * width + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Resamples the mosaic onto the grid: cell centres span the box edge to edge. */
export function resampleMosaicToGrid(mosaic: ElevationMosaic, box: MercatorBox, grid: GridSize): Float32Array {
  const { width, height } = grid;
  const out = new Float32Array(width * height);
  const du = width > 1 ? box.width / (width - 1) : 0;
  const dv = height > 1 ? box.height / (height - 1) : 0;
  for (let y = 0; y < height; y++) {
    const fy = box.top + y * dv - mosaic.originY - 0.5;
    for (let x = 0; x < width; x++) {
      const fx = box.left + x * du - mosaic.originX - 0.5;
      out[y * width + x] = sampleBilinear(mosaic.meters, mosaic.width, mosaic.height, fx, fy);
    }
  }
  return out;
}

/**
 * Bilinear resample between grids framing the same place (same width, centred, square cells), so placeUV stays valid
 * even when the aspect differs; rows beyond the source clamp to its edge.
 */
export function resampleGrid(values: Float32Array, from: GridSize, to: GridSize): Float32Array {
  if (from.width === to.width && from.height === to.height) return values.slice();
  const out = new Float32Array(to.width * to.height);
  const step = to.width > 1 ? (from.width - 1) / (to.width - 1) : 0;
  const fromMidY = (from.height - 1) / 2;
  const toMidY = (to.height - 1) / 2;
  for (let y = 0; y < to.height; y++) {
    const fy = fromMidY + (y - toMidY) * step;
    for (let x = 0; x < to.width; x++) out[y * to.width + x] = sampleBilinear(values, from.width, from.height, x * step, fy);
  }
  return out;
}
