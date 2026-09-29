// Binary format of public/places/<id>.bin (little-endian), self-describing so the app needs a single fetch:
//   0 u32 magic "LSP1", 4 u16 version=1, 6 u16 width, 8 u16 height, 10 u16 source flags, 12 f32 minMeters,
//   16 f32 maxMeters, 20 u16 tile zoom, 22 u16 reserved, 24.. u16 per cell (row-major, north = row 0):
//   meters = minMeters + q / 65535 * (maxMeters - minMeters). Per-place quantization keeps flat deltas sub-meter.

export const BAKED_PLACE_MAGIC = 0x3150534c;
export const BAKED_PLACE_VERSION = 1;
export const BAKED_PLACE_HEADER_BYTES = 24;
const Q_MAX = 65535;

export interface BakedPlaceData {
  width: number;
  height: number;
  sourceFlags: number;
  zoom: number;
  minMeters: number;
  maxMeters: number;
  meters: Float32Array;
}

export class BakedPlaceFormatError extends Error {}

export function encodeBakedPlace(input: { meters: Float32Array; width: number; height: number; sourceFlags: number; zoom: number }): Uint8Array {
  const { meters, width, height } = input;
  if (meters.length !== width * height) throw new RangeError(`Expected ${width * height} heights, got ${meters.length}`);
  let min = Infinity;
  let max = -Infinity;
  for (const m of meters) {
    if (!Number.isFinite(m)) throw new RangeError('Heights must be finite');
    min = Math.min(min, m);
    max = Math.max(max, m);
  }
  // Round the range outward to f32 so every stored value decodes inside [min, max].
  const minMeters = Math.fround(min) > min ? Math.fround(min - 0.01) : Math.fround(min);
  const maxMeters = Math.fround(max) < max ? Math.fround(max + 0.01) : Math.fround(max);
  const span = maxMeters - minMeters;
  const bytes = new Uint8Array(BAKED_PLACE_HEADER_BYTES + meters.length * 2);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, BAKED_PLACE_MAGIC, true);
  view.setUint16(4, BAKED_PLACE_VERSION, true);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  view.setUint16(10, input.sourceFlags, true);
  view.setFloat32(12, minMeters, true);
  view.setFloat32(16, maxMeters, true);
  view.setUint16(20, input.zoom, true);
  meters.forEach((m, i) => {
    const q = span > 0 ? Math.round(((m - minMeters) / span) * Q_MAX) : 0;
    view.setUint16(BAKED_PLACE_HEADER_BYTES + i * 2, Math.max(0, Math.min(Q_MAX, q)), true);
  });
  return bytes;
}

export function decodeBakedPlace(buf: ArrayBuffer | Uint8Array): BakedPlaceData {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.byteLength < BAKED_PLACE_HEADER_BYTES) throw new BakedPlaceFormatError(`Place data too short (${bytes.byteLength} bytes)`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== BAKED_PLACE_MAGIC) throw new BakedPlaceFormatError('Not a LiveSand place file (bad magic)');
  const version = view.getUint16(4, true);
  if (version !== BAKED_PLACE_VERSION) throw new BakedPlaceFormatError(`Unsupported place file version ${version}`);
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);
  const expected = BAKED_PLACE_HEADER_BYTES + width * height * 2;
  if (width === 0 || height === 0 || bytes.byteLength !== expected) {
    throw new BakedPlaceFormatError(`Place file size ${bytes.byteLength} does not match ${width}x${height} (expected ${expected})`);
  }
  const minMeters = view.getFloat32(12, true);
  const maxMeters = view.getFloat32(16, true);
  if (!Number.isFinite(minMeters) || !Number.isFinite(maxMeters) || maxMeters < minMeters) {
    throw new BakedPlaceFormatError(`Invalid height range ${minMeters}..${maxMeters}`);
  }
  const span = maxMeters - minMeters;
  const meters = new Float32Array(width * height);
  for (let i = 0; i < meters.length; i++) {
    meters[i] = minMeters + (view.getUint16(BAKED_PLACE_HEADER_BYTES + i * 2, true) / Q_MAX) * span;
  }
  return { width, height, sourceFlags: view.getUint16(10, true), zoom: view.getUint16(20, true), minMeters, maxMeters, meters };
}
