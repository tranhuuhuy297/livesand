// Terrarium elevation encoding used by the AWS Terrain Tiles: meters = R * 256 + G + B / 256 - 32768.

/** Terrarium tiles are always 256 x 256 px. */
export const TERRARIUM_TILE_SIZE = 256;

export function decodeTerrariumMeters(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Decodes an RGBA pixel buffer (e.g. ImageData.data or pngjs output) into meters, one value per pixel. */
export function decodeTerrariumRgba(rgba: ArrayLike<number>, width: number, height: number): Float32Array {
  const count = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Invalid Terrarium image size ${width}x${height}`);
  }
  if (rgba.length < count * 4) {
    throw new RangeError(`Terrarium RGBA buffer too short: ${rgba.length} bytes for ${width}x${height}`);
  }
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = decodeTerrariumMeters(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  }
  return out;
}

/** Inverse of decodeTerrariumMeters (used to build synthetic tiles in tests and tools). */
export function encodeTerrariumMeters(meters: number): [number, number, number] {
  const v = Math.min(65535.996, Math.max(0, meters + 32768));
  const r = Math.floor(v / 256);
  const g = Math.floor(v - r * 256);
  const b = Math.min(255, Math.round((v - r * 256 - g) * 256));
  return [r, g, b];
}

export function terrariumTileUrl(z: number, x: number, y: number): string {
  return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
}
