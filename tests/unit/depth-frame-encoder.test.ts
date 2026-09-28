import { describe, expect, it } from 'vitest';
import {
  DepthFormat as SrcDepthFormat,
  decodeDepthFrame,
  encodeDepthFrame as srcEncodeDepthFrame,
} from '../../src/core/depth-frame-protocol';
import {
  DEPTH_FRAME_HEADER_BYTES,
  DEPTH_FRAME_MAGIC,
  DepthFormat,
  depthFrameByteLength,
  encodeDepthFrame,
} from '../../server/depth-frame-encoder.js';
import { synthesizeFakeDepth } from '../../server/fake-depth-source.js';

const MM = new Uint16Array([0, 1000, 65535, 1, 2, 3]);
const METERS = new Float32Array([0, 0.5, 1.25, 2, 3.5, 7.75]);

describe('server depth-frame encoder: wire layout', () => {
  it('writes the LSD1 header little-endian at the documented offsets', () => {
    const buf = encodeDepthFrame({ width: 3, height: 2, format: DepthFormat.Uint16Millimeters, timestampMs: 1234.5, frameIndex: 42, data: MM });
    const bytes = new Uint8Array(buf);
    const view = new DataView(buf);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('LSD1');
    expect(DEPTH_FRAME_MAGIC).toBe(0x3144534c);
    expect(view.getUint32(0, true)).toBe(DEPTH_FRAME_MAGIC);
    expect(view.getUint16(4, true)).toBe(1);
    expect(view.getUint16(6, true)).toBe(2);
    expect(view.getUint32(8, true)).toBe(3);
    expect(view.getUint32(12, true)).toBe(2);
    expect(view.getFloat64(16, true)).toBe(1234.5);
    expect(view.getUint32(24, true)).toBe(42);
    expect(DEPTH_FRAME_HEADER_BYTES).toBe(28);
    expect(buf.byteLength).toBe(28 + 6 * 2);
    expect(buf.byteLength).toBe(depthFrameByteLength(3, 2, DepthFormat.Uint16Millimeters));
    expect(Array.from(MM, (_, i) => view.getUint16(28 + i * 2, true))).toEqual([...MM]);
  });

  it('writes float32 payloads row-major', () => {
    const buf = encodeDepthFrame({ width: 2, height: 3, format: DepthFormat.Float32Meters, timestampMs: 0, frameIndex: 0, data: METERS });
    const view = new DataView(buf);
    expect(view.getUint16(6, true)).toBe(1);
    expect(buf.byteLength).toBe(28 + 6 * 4);
    expect(Array.from(METERS, (_, i) => view.getFloat32(28 + i * 4, true))).toEqual([...METERS]);
  });

  it('honours byteOffset of typed-array views and wraps frameIndex modulo 2^32', () => {
    const backing = new Uint16Array(10).fill(9);
    backing.set(MM, 3);
    const view = new Uint16Array(backing.buffer, 3 * 2, 6);
    const buf = encodeDepthFrame({ width: 3, height: 2, format: DepthFormat.Uint16Millimeters, timestampMs: 1, frameIndex: 2 ** 32 + 5, data: view });
    const dv = new DataView(buf);
    expect(dv.getUint32(24, true)).toBe(5);
    expect(Array.from(MM, (_, i) => dv.getUint16(28 + i * 2, true))).toEqual([...MM]);
  });

  it('rejects inconsistent input', () => {
    const base = { width: 3, height: 2, format: DepthFormat.Uint16Millimeters, timestampMs: 0, frameIndex: 0, data: MM };
    expect(() => encodeDepthFrame({ ...base, width: 4 })).toThrow(RangeError);
    expect(() => encodeDepthFrame({ ...base, width: 0 })).toThrow(RangeError);
    expect(() => encodeDepthFrame({ ...base, height: 1.5 })).toThrow(RangeError);
    expect(() => encodeDepthFrame({ ...base, data: METERS })).toThrow(TypeError);
    expect(() => encodeDepthFrame({ ...base, format: DepthFormat.Float32Meters })).toThrow(TypeError);
    expect(() => encodeDepthFrame({ ...base, timestampMs: Number.NaN })).toThrow(RangeError);
    expect(() => encodeDepthFrame({ ...base, frameIndex: -1 })).toThrow(RangeError);
    expect(() => encodeDepthFrame({ ...base, format: 7 as DepthFormat })).toThrow(RangeError);
  });
});

describe('server depth-frame encoder: compatibility with the browser codec', () => {
  it('produces byte-identical frames to src/core encodeDepthFrame', () => {
    const cases = [
      { format: DepthFormat.Uint16Millimeters, src: SrcDepthFormat.Uint16Millimeters, data: MM },
      { format: DepthFormat.Float32Meters, src: SrcDepthFormat.Float32Meters, data: METERS },
    ] as const;
    for (const c of cases) {
      const header = { width: 3, height: 2, timestampMs: 98765.25, frameIndex: 777 };
      const mine = new Uint8Array(encodeDepthFrame({ ...header, format: c.format, data: c.data }));
      const theirs = new Uint8Array(srcEncodeDepthFrame({ ...header, format: c.src, data: c.data }));
      expect(mine).toEqual(theirs);
    }
  });

  it('decodes uint16 millimetre frames to meters with src decodeDepthFrame', () => {
    const buf = encodeDepthFrame({ width: 3, height: 2, format: DepthFormat.Uint16Millimeters, timestampMs: 55.5, frameIndex: 9, data: MM });
    const frame = decodeDepthFrame(buf);
    expect(frame).toMatchObject({ width: 3, height: 2, timestampMs: 55.5, frameIndex: 9 });
    expect(Array.from(frame.depthMeters)).toEqual(Array.from(MM, (mm) => Math.fround(mm / 1000)));
    expect(decodeDepthFrame(new Uint8Array(buf)).depthMeters).toEqual(frame.depthMeters);
  });

  it('decodes float32 meter frames with src decodeDepthFrame', () => {
    const buf = encodeDepthFrame({ width: 2, height: 3, format: DepthFormat.Float32Meters, timestampMs: 1, frameIndex: 2, data: METERS });
    const frame = decodeDepthFrame(buf);
    expect([frame.width, frame.height, frame.frameIndex]).toEqual([2, 3, 2]);
    expect(frame.depthMeters).toEqual(METERS);
  });

  it('round-trips a synthetic fake-source frame (flat sand ~1 m, mound, hand ~0.7 m)', () => {
    const width = 256;
    const height = 192;
    const depth = synthesizeFakeDepth(width, height, 12.5);
    const frame = decodeDepthFrame(
      encodeDepthFrame({ width, height, format: DepthFormat.Uint16Millimeters, timestampMs: 0, frameIndex: 1, data: depth }),
    );
    const values = Array.from(frame.depthMeters);
    expect(values.every((d) => d >= 0.699 && d <= 1.003)).toBe(true);
    expect(values.filter((d) => Math.abs(d - 0.7) < 1e-6).length).toBeGreaterThan(100); // hand blob pixels
    expect(Math.min(...values.filter((d) => d > 0.75))).toBeLessThan(0.9); // mound summit rises ~120 mm
    expect(frame.depthMeters[0]).toBeGreaterThan(0.99); // corner is flat sand
  });
});
