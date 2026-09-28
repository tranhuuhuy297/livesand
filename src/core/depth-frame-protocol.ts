// LSD1 depth-frame wire format, shared byte-for-byte with server/ and the iOS app (little-endian).
//   0 u32 magic "LSD1" | 4 u16 version | 6 u16 format | 8 u32 width | 12 u32 height
//   16 f64 timestampMs | 24 u32 frameIndex | 28.. payload (row-major, row 0 = top of image)

export const DEPTH_FRAME_MAGIC = 0x3144534c;
export const DEPTH_FRAME_HEADER_BYTES = 28;
export const DEPTH_FRAME_VERSION = 1;
// Checked before allocating: a huge but byte-exact frame would otherwise freeze or crash the tab (LiDAR is 256x192).
// Mirrored in server/depth-frame-encoder.ts, which also sizes the relay's message limit from them.
export const MAX_DEPTH_SIDE = 4096;
export const MAX_DEPTH_PIXELS = 1024 * 1024;

/** Payload encoding; an invalid pixel is 0 in either format. */
export enum DepthFormat {
  Float32Meters = 1,
  Uint16Millimeters = 2,
}

export interface DepthFrame {
  width: number;
  height: number;
  timestampMs: number;
  frameIndex: number;
  /** Row-major meters; 0 = invalid pixel. */
  depthMeters: Float32Array;
}

export interface EncodeDepthFrameInput {
  width: number;
  height: number;
  format: DepthFormat;
  timestampMs: number;
  frameIndex: number;
  data: Float32Array | Uint16Array;
}

export class DepthFrameDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DepthFrameDecodeError';
  }
}

function exceedsDepthLimits(width: number, height: number): boolean {
  return width > MAX_DEPTH_SIDE || height > MAX_DEPTH_SIDE || width * height > MAX_DEPTH_PIXELS;
}

function bytesPerPixel(format: number): number {
  if (format === DepthFormat.Float32Meters) return 4;
  if (format === DepthFormat.Uint16Millimeters) return 2;
  return 0;
}

export function encodeDepthFrame(input: EncodeDepthFrameInput): ArrayBuffer {
  const { width, height, format, timestampMs, frameIndex, data } = input;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || exceedsDepthLimits(width, height)) {
    throw new RangeError(`Invalid depth frame size ${width}x${height}`);
  }
  if (!Number.isInteger(frameIndex) || frameIndex < 0) throw new RangeError(`Invalid frameIndex ${frameIndex}`);
  if (!Number.isFinite(timestampMs)) throw new RangeError(`Invalid timestampMs ${timestampMs}`);
  const bpp = bytesPerPixel(format);
  if (bpp === 0) throw new RangeError(`Unknown depth format ${format}`);
  const expectedType = format === DepthFormat.Float32Meters ? Float32Array : Uint16Array;
  if (!(data instanceof expectedType)) {
    throw new TypeError(`Format ${DepthFormat[format]} requires ${expectedType.name} data`);
  }
  const count = width * height;
  if (data.length !== count) throw new RangeError(`Depth data has ${data.length} values, expected ${count}`);

  const buf = new ArrayBuffer(DEPTH_FRAME_HEADER_BYTES + count * bpp);
  const view = new DataView(buf);
  view.setUint32(0, DEPTH_FRAME_MAGIC, true);
  view.setUint16(4, DEPTH_FRAME_VERSION, true);
  view.setUint16(6, format, true);
  view.setUint32(8, width, true);
  view.setUint32(12, height, true);
  view.setFloat64(16, timestampMs, true);
  view.setUint32(24, frameIndex >>> 0, true); // counters wrap modulo 2^32
  let off = DEPTH_FRAME_HEADER_BYTES;
  if (format === DepthFormat.Float32Meters) {
    for (let i = 0; i < count; i++, off += 4) view.setFloat32(off, data[i], true);
  } else {
    for (let i = 0; i < count; i++, off += 2) view.setUint16(off, data[i], true);
  }
  return buf;
}

// isView / toString checks work across realms (workers, test runners) unlike instanceof.
function toDataView(buf: ArrayBuffer | Uint8Array): DataView {
  if (ArrayBuffer.isView(buf)) return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (Object.prototype.toString.call(buf) === '[object ArrayBuffer]') return new DataView(buf);
  throw new DepthFrameDecodeError('Depth frame must be an ArrayBuffer or Uint8Array');
}

/** Validates magic/version/format/size and converts the payload to meters (invalid -> 0). */
export function decodeDepthFrame(buf: ArrayBuffer | Uint8Array): DepthFrame {
  const view = toDataView(buf);
  if (view.byteLength < DEPTH_FRAME_HEADER_BYTES) {
    throw new DepthFrameDecodeError(`Depth frame too short: ${view.byteLength} bytes, header needs ${DEPTH_FRAME_HEADER_BYTES}`);
  }
  const magic = view.getUint32(0, true);
  if (magic !== DEPTH_FRAME_MAGIC) {
    throw new DepthFrameDecodeError(`Bad depth frame magic 0x${magic.toString(16).padStart(8, '0')}`);
  }
  const version = view.getUint16(4, true);
  if (version !== DEPTH_FRAME_VERSION) throw new DepthFrameDecodeError(`Unsupported depth frame version ${version}`);
  const format = view.getUint16(6, true);
  const bpp = bytesPerPixel(format);
  if (bpp === 0) throw new DepthFrameDecodeError(`Unknown depth format ${format}`);
  const width = view.getUint32(8, true);
  const height = view.getUint32(12, true);
  if (width === 0 || height === 0) throw new DepthFrameDecodeError(`Invalid depth frame size ${width}x${height}`);
  if (exceedsDepthLimits(width, height)) {
    throw new DepthFrameDecodeError(`Depth frame ${width}x${height} is larger than the ${MAX_DEPTH_PIXELS}-pixel limit`);
  }
  const count = width * height;
  const expected = DEPTH_FRAME_HEADER_BYTES + count * bpp;
  if (view.byteLength !== expected) {
    throw new DepthFrameDecodeError(`Depth frame is ${view.byteLength} bytes, expected ${expected} for ${width}x${height}`);
  }
  const timestampMs = view.getFloat64(16, true);
  const frameIndex = view.getUint32(24, true);

  const depthMeters = new Float32Array(count);
  let off = DEPTH_FRAME_HEADER_BYTES;
  if (format === DepthFormat.Float32Meters) {
    for (let i = 0; i < count; i++, off += 4) {
      const d = view.getFloat32(off, true);
      depthMeters[i] = d > 0 && d < Infinity ? d : 0; // NaN / negative / inf are invalid
    }
  } else {
    for (let i = 0; i < count; i++, off += 2) depthMeters[i] = view.getUint16(off, true) / 1000;
  }
  return { width, height, timestampMs, frameIndex, depthMeters };
}
