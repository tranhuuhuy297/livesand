import { describe, expect, it } from 'vitest';
import {
  DEPTH_FRAME_HEADER_BYTES,
  DEPTH_FRAME_MAGIC,
  DepthFormat,
  DepthFrameDecodeError,
  decodeDepthFrame,
  encodeDepthFrame,
} from '../../src/core/depth-frame-protocol';

function uint16Frame(): ArrayBuffer {
  return encodeDepthFrame({
    width: 3,
    height: 2,
    format: DepthFormat.Uint16Millimeters,
    timestampMs: 1234.5,
    frameIndex: 42,
    data: Uint16Array.of(0, 1000, 1500, 65535, 1, 700),
  });
}

describe('depth frame wire format', () => {
  it('exposes the documented constants', () => {
    expect(DEPTH_FRAME_MAGIC).toBe(0x3144534c);
    expect(DEPTH_FRAME_HEADER_BYTES).toBe(28);
    expect(DepthFormat.Float32Meters).toBe(1);
    expect(DepthFormat.Uint16Millimeters).toBe(2);
  });

  it('writes the exact little-endian header layout and uint16 payload', () => {
    const buf = uint16Frame();
    expect(buf.byteLength).toBe(28 + 6 * 2);
    const bytes = new Uint8Array(buf);
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe('LSD1');
    expect([...bytes.subarray(0, 12)]).toEqual([0x4c, 0x53, 0x44, 0x31, 1, 0, 2, 0, 3, 0, 0, 0]);
    const view = new DataView(buf);
    expect(view.getUint32(0, true)).toBe(DEPTH_FRAME_MAGIC);
    expect(view.getUint16(4, true)).toBe(1);
    expect(view.getUint16(6, true)).toBe(DepthFormat.Uint16Millimeters);
    expect(view.getUint32(8, true)).toBe(3);
    expect(view.getUint32(12, true)).toBe(2);
    expect(view.getFloat64(16, true)).toBe(1234.5);
    expect(view.getUint32(24, true)).toBe(42);
    expect(view.getUint16(28, true)).toBe(0);
    expect(view.getUint16(30, true)).toBe(1000);
    expect(bytes[30]).toBe(1000 & 0xff);
    expect(bytes[31]).toBe(1000 >> 8);
    expect(view.getUint16(28 + 5 * 2, true)).toBe(700);
  });

  it('writes float32 payloads at offset 28', () => {
    const buf = encodeDepthFrame({
      width: 2, height: 1, format: DepthFormat.Float32Meters, timestampMs: 0, frameIndex: 0,
      data: Float32Array.of(0.75, 1.25),
    });
    expect(buf.byteLength).toBe(28 + 8);
    const view = new DataView(buf);
    expect(view.getUint16(6, true)).toBe(1);
    expect(view.getFloat32(28, true)).toBe(0.75);
    expect(view.getFloat32(32, true)).toBe(1.25);
  });

  it('decodes uint16 millimeters to meters (0 stays invalid)', () => {
    const frame = decodeDepthFrame(uint16Frame());
    expect(frame.width).toBe(3);
    expect(frame.height).toBe(2);
    expect(frame.timestampMs).toBe(1234.5);
    expect(frame.frameIndex).toBe(42);
    expect(frame.depthMeters).toBeInstanceOf(Float32Array);
    const expected = [0, 1, 1.5, 65.535, 0.001, 0.7];
    expected.forEach((v, i) => expect(frame.depthMeters[i]).toBeCloseTo(v, 5));
    expect(frame.depthMeters[0]).toBe(0);
  });

  it('round-trips float32 meters and sanitizes NaN / negative / infinite pixels to 0', () => {
    const data = Float32Array.of(1.5, NaN, -2, Infinity, 0, 0.123);
    const buf = encodeDepthFrame({ width: 2, height: 3, format: DepthFormat.Float32Meters, timestampMs: 99, frameIndex: 7, data });
    const frame = decodeDepthFrame(buf);
    expect([...frame.depthMeters]).toEqual([1.5, 0, 0, 0, 0, Math.fround(0.123)]);
    expect(frame.frameIndex).toBe(7);
  });

  it('decodes a hand-built buffer (independent of the encoder) from an unaligned Uint8Array view', () => {
    const payload = 28 + 2 * 2;
    const backing = new Uint8Array(payload + 5);
    const view = new DataView(backing.buffer, 3, payload);
    view.setUint8(0, 'L'.charCodeAt(0));
    view.setUint8(1, 'S'.charCodeAt(0));
    view.setUint8(2, 'D'.charCodeAt(0));
    view.setUint8(3, '1'.charCodeAt(0));
    view.setUint16(4, 1, true);
    view.setUint16(6, 2, true);
    view.setUint32(8, 2, true);
    view.setUint32(12, 1, true);
    view.setFloat64(16, 55.25, true);
    view.setUint32(24, 0xfffffffe, true);
    view.setUint16(28, 820, true);
    view.setUint16(30, 1001, true);
    const frame = decodeDepthFrame(backing.subarray(3, 3 + payload));
    expect(frame.width).toBe(2);
    expect(frame.height).toBe(1);
    expect(frame.timestampMs).toBe(55.25);
    expect(frame.frameIndex).toBe(0xfffffffe);
    expect(frame.depthMeters[0]).toBeCloseTo(0.82, 6);
    expect(frame.depthMeters[1]).toBeCloseTo(1.001, 6);
  });

  it('rejects bad magic, short buffers, truncated payloads, bad version/format/size', () => {
    const good = new Uint8Array(uint16Frame());
    const withByte = (offset: number, value: number): Uint8Array => {
      const copy = good.slice();
      copy[offset] = value;
      return copy;
    };
    expect(() => decodeDepthFrame(withByte(0, 0x58))).toThrow(DepthFrameDecodeError);
    expect(() => decodeDepthFrame(withByte(0, 0x58))).toThrow(/magic/);
    expect(() => decodeDepthFrame(good.slice(0, 20))).toThrow(/too short/);
    expect(() => decodeDepthFrame(new ArrayBuffer(0))).toThrow(DepthFrameDecodeError);
    expect(() => decodeDepthFrame(good.slice(0, good.length - 1))).toThrow(/expected/);
    expect(() => decodeDepthFrame(new Uint8Array([...good, 0]))).toThrow(/expected/);
    expect(() => decodeDepthFrame(withByte(4, 2))).toThrow(/version/);
    expect(() => decodeDepthFrame(withByte(6, 9))).toThrow(/format/);
    expect(() => decodeDepthFrame(withByte(8, 0))).toThrow(/size/);
    const err = (() => { try { decodeDepthFrame(withByte(1, 0)); } catch (e) { return e; } })();
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('DepthFrameDecodeError');
  });

  it('validates encoder input', () => {
    const base = { width: 2, height: 2, timestampMs: 0, frameIndex: 0 };
    expect(() => encodeDepthFrame({ ...base, format: DepthFormat.Uint16Millimeters, data: new Uint16Array(3) })).toThrow(RangeError);
    expect(() => encodeDepthFrame({ ...base, format: DepthFormat.Uint16Millimeters, data: new Float32Array(4) })).toThrow(TypeError);
    expect(() => encodeDepthFrame({ ...base, format: DepthFormat.Float32Meters, data: new Uint16Array(4) })).toThrow(TypeError);
    expect(() => encodeDepthFrame({ ...base, width: 0, format: DepthFormat.Float32Meters, data: new Float32Array(0) })).toThrow(RangeError);
    expect(() => encodeDepthFrame({ ...base, frameIndex: -1, format: DepthFormat.Float32Meters, data: new Float32Array(4) })).toThrow(RangeError);
    expect(() => encodeDepthFrame({ ...base, format: 7 as DepthFormat, data: new Float32Array(4) })).toThrow(RangeError);
  });
});
