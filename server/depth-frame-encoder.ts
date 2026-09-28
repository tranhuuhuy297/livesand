// LSD1 depth-frame encoder for Node; byte-for-byte twin of the browser codec (kept separate: different module system).
// Layout (little-endian): 0 u32 magic, 4 u16 version, 6 u16 format, 8 u32 width, 12 u32 height,
// 16 f64 timestampMs, 24 u32 frameIndex, 28.. row-major payload (row 0 = top of image).

export const DEPTH_FRAME_MAGIC = 0x3144534c;
export const DEPTH_FRAME_VERSION = 1;
export const DEPTH_FRAME_HEADER_BYTES = 28;
// Same caps as src/core/depth-frame-protocol.ts: iPhone LiDAR sends 256x192; 1024x1024 f32 (4 MiB) is plenty.
export const MAX_DEPTH_SIDE = 4096;
export const MAX_DEPTH_PIXELS = 1024 * 1024;
export const MAX_DEPTH_FRAME_BYTES = DEPTH_FRAME_HEADER_BYTES + MAX_DEPTH_PIXELS * 4;

export const DepthFormat = { Float32Meters: 1, Uint16Millimeters: 2 } as const;
export type DepthFormat = (typeof DepthFormat)[keyof typeof DepthFormat];

export interface EncodeDepthFrameInput {
  width: number;
  height: number;
  format: DepthFormat;
  timestampMs: number;
  frameIndex: number;
  data: Float32Array | Uint16Array;
}

const HOST_IS_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** Bytes per depth sample for a wire format. */
export function depthFormatBytesPerPixel(format: DepthFormat): 2 | 4 {
  if (format === DepthFormat.Float32Meters) return 4;
  if (format === DepthFormat.Uint16Millimeters) return 2;
  throw new RangeError(`unknown depth format ${String(format)}`);
}

/** Total encoded size of a frame (header + payload). */
export function depthFrameByteLength(width: number, height: number, format: DepthFormat): number {
  return DEPTH_FRAME_HEADER_BYTES + width * height * depthFormatBytesPerPixel(format);
}

function checkDimension(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_DEPTH_SIDE) {
    throw new RangeError(`${name} must be an integer in 1..${MAX_DEPTH_SIDE}, got ${value}`);
  }
}

/** Throws unless width x height is a frame size the browser decoder accepts. */
export function checkDepthFrameSize(width: number, height: number): void {
  checkDimension('width', width);
  checkDimension('height', height);
  if (width * height > MAX_DEPTH_PIXELS) throw new RangeError(`${width}x${height} exceeds ${MAX_DEPTH_PIXELS} pixels`);
}

/** Frame index of a well-formed LSD1 frame (header, size caps, exact length), or null for anything else. */
export function lsd1FrameIndex(bytes: Uint8Array): number | null {
  if (bytes.byteLength < DEPTH_FRAME_HEADER_BYTES || bytes.byteLength > MAX_DEPTH_FRAME_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== DEPTH_FRAME_MAGIC || view.getUint16(4, true) !== DEPTH_FRAME_VERSION) return null;
  const format = view.getUint16(6, true);
  const bytesPerPixel = format === DepthFormat.Float32Meters ? 4 : format === DepthFormat.Uint16Millimeters ? 2 : 0;
  const width = view.getUint32(8, true);
  const height = view.getUint32(12, true);
  if (bytesPerPixel === 0 || width === 0 || height === 0 || width > MAX_DEPTH_SIDE || height > MAX_DEPTH_SIDE) return null;
  if (width * height > MAX_DEPTH_PIXELS) return null;
  if (bytes.byteLength !== DEPTH_FRAME_HEADER_BYTES + width * height * bytesPerPixel) return null;
  return view.getUint32(24, true);
}

/** Encodes one depth frame into the LSD1 wire format. */
export function encodeDepthFrame(input: EncodeDepthFrameInput): ArrayBuffer {
  const { width, height, format, data, timestampMs, frameIndex } = input;
  checkDepthFrameSize(width, height);
  const bytesPerPixel = depthFormatBytesPerPixel(format);
  const expectFloat = format === DepthFormat.Float32Meters;
  if (expectFloat ? !(data instanceof Float32Array) : !(data instanceof Uint16Array)) {
    throw new TypeError(`format ${format} requires ${expectFloat ? 'Float32Array' : 'Uint16Array'} data`);
  }
  const pixels = width * height;
  if (data.length !== pixels) throw new RangeError(`data has ${data.length} samples, expected ${width}x${height}=${pixels}`);
  if (!Number.isFinite(timestampMs)) throw new RangeError('timestampMs must be finite');
  if (!Number.isInteger(frameIndex) || frameIndex < 0) throw new RangeError('frameIndex must be a non-negative integer');

  const buf = new ArrayBuffer(DEPTH_FRAME_HEADER_BYTES + pixels * bytesPerPixel);
  const view = new DataView(buf);
  view.setUint32(0, DEPTH_FRAME_MAGIC, true);
  view.setUint16(4, DEPTH_FRAME_VERSION, true);
  view.setUint16(6, format, true);
  view.setUint32(8, width, true);
  view.setUint32(12, height, true);
  view.setFloat64(16, timestampMs, true);
  view.setUint32(24, frameIndex >>> 0, true); // counters wrap at 2^32 like the u32 field

  if (HOST_IS_LITTLE_ENDIAN) {
    new Uint8Array(buf, DEPTH_FRAME_HEADER_BYTES).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  } else if (expectFloat) {
    for (let i = 0; i < pixels; i++) view.setFloat32(DEPTH_FRAME_HEADER_BYTES + i * 4, data[i], true);
  } else {
    for (let i = 0; i < pixels; i++) view.setUint16(DEPTH_FRAME_HEADER_BYTES + i * 2, data[i], true);
  }
  return buf;
}
