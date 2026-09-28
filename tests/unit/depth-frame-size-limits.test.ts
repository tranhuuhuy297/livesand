// Frame-size caps shared by the browser decoder, the Node encoder and the relay's LSD1 check.
import { describe, expect, it } from 'vitest';
import {
  DEPTH_FRAME_HEADER_BYTES,
  DEPTH_FRAME_MAGIC,
  DepthFrameDecodeError,
  MAX_DEPTH_PIXELS,
  MAX_DEPTH_SIDE,
  decodeDepthFrame,
} from '../../src/core/depth-frame-protocol';
import * as server from '../../server/depth-frame-encoder.js';

/** A byte-exact uint16 frame claiming width x height (zero depth), as a hostile source could send. */
function claimedFrame(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(DEPTH_FRAME_HEADER_BYTES + width * height * 2);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, DEPTH_FRAME_MAGIC, true);
  view.setUint16(4, 1, true);
  view.setUint16(6, 2, true);
  view.setUint32(8, width, true);
  view.setUint32(12, height, true);
  view.setUint32(24, 5, true);
  return bytes;
}

describe('depth frame size limits', () => {
  it('match between the browser decoder and the Node encoder/relay', () => {
    expect(server.MAX_DEPTH_SIDE).toBe(MAX_DEPTH_SIDE);
    expect(server.MAX_DEPTH_PIXELS).toBe(MAX_DEPTH_PIXELS);
    expect(server.MAX_DEPTH_FRAME_BYTES).toBe(DEPTH_FRAME_HEADER_BYTES + MAX_DEPTH_PIXELS * 4);
  });

  it('decoder rejects oversized but byte-exact frames before allocating', () => {
    expect(() => decodeDepthFrame(claimedFrame(2048, 1024))).toThrow(DepthFrameDecodeError);
    expect(() => decodeDepthFrame(claimedFrame(2048, 1024))).toThrow(/limit/);
    expect(() => decodeDepthFrame(claimedFrame(MAX_DEPTH_SIDE + 1, 1))).toThrow(/limit/);
    expect(decodeDepthFrame(claimedFrame(1024, 1024)).depthMeters).toHaveLength(MAX_DEPTH_PIXELS);
    expect(decodeDepthFrame(claimedFrame(MAX_DEPTH_SIDE, 2)).width).toBe(MAX_DEPTH_SIDE);
  });

  it('relay accepts exactly the frames the decoder accepts', () => {
    expect(server.lsd1FrameIndex(claimedFrame(256, 192))).toBe(5);
    expect(server.lsd1FrameIndex(claimedFrame(2048, 1024))).toBeNull();
    expect(server.lsd1FrameIndex(claimedFrame(MAX_DEPTH_SIDE + 1, 1))).toBeNull();
    expect(server.lsd1FrameIndex(claimedFrame(4, 3).subarray(0, 30))).toBeNull();
    const badMagic = claimedFrame(4, 3);
    badMagic[0] = 0;
    expect(server.lsd1FrameIndex(badMagic)).toBeNull();
  });

  it('encoders refuse sizes the decoder would reject', () => {
    const data = new Uint16Array(2048 * 1024);
    const input = { width: 2048, height: 1024, format: server.DepthFormat.Uint16Millimeters, timestampMs: 0, frameIndex: 0, data };
    expect(() => server.encodeDepthFrame(input)).toThrow(RangeError);
    expect(() => server.checkDepthFrameSize(MAX_DEPTH_SIDE + 1, 1)).toThrow(RangeError);
  });
});
