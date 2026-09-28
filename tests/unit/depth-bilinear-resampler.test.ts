import { describe, expect, it } from 'vitest';
import { sampleDepthBilinear } from '../../src/core/depth-bilinear-resampler';
import type { DepthFrame } from '../../src/core/depth-frame-protocol';
import { DepthTerrainProcessor } from '../../src/core/depth-terrain-processor';
import type { Quad } from '../../src/core/types';
import { calibration, grid, idx, makeFrame } from './depth-test-fixtures';

describe('depth resampling', () => {
  it('maps cell centres 1:1 onto pixel centres when grid and ROI match the image', () => {
    const p = new DepthTerrainProcessor(grid, calibration());
    const out = p.resampleDepth(makeFrame(32, 24, (x, y) => 1 + x * 0.01 + y * 0.001));
    expect(out).toHaveLength(grid.width * grid.height);
    expect(out[idx(0, 0)]).toBeCloseTo(1, 5);
    expect(out[idx(31, 23)]).toBeCloseTo(1 + 0.31 + 0.023, 5);
    expect(out[idx(7, 5)]).toBeCloseTo(1.075, 5);
  });

  it('follows the ROI homography into a sub-rectangle of a larger image', () => {
    const roiQuad: Quad = [{ x: 10, y: 20 }, { x: 74, y: 20 }, { x: 74, y: 68 }, { x: 10, y: 68 }];
    const p = new DepthTerrainProcessor(grid, calibration(100, 80, { roiQuad }));
    const out = p.resampleDepth(makeFrame(100, 80, (x, y) => 1 + 0.001 * x + 0.002 * y));
    // Cell (x, y) centre lands on pixel index (10.5 + 2x, 20.5 + 2y); bilinear reproduces linear fields exactly.
    for (const [x, y] of [[0, 0], [31, 23], [5, 17]]) {
      expect(out[idx(x, y)]).toBeCloseTo(1 + 0.001 * (10.5 + 2 * x) + 0.002 * (20.5 + 2 * y), 5);
    }
  });

  it('ignores invalid neighbours instead of blending them towards 0', () => {
    const p = new DepthTerrainProcessor(grid, calibration(64, 48));
    // 2x downsample: every cell blends 4 pixels; zero one of each quartet.
    const holes = p.resampleDepth(makeFrame(64, 48, (x, y) => (x % 2 === 0 && y % 2 === 0 ? 0 : 0.9)));
    holes.forEach((v) => expect(v).toBeCloseTo(0.9, 6));
    const dead = p.resampleDepth(makeFrame(64, 48, (x) => (x < 8 ? 0 : 0.9)));
    expect(dead[idx(0, 3)]).toBe(0);
    expect(dead[idx(3, 3)]).toBe(0);
    expect(dead[idx(4, 3)]).toBeCloseTo(0.9, 6);
    expect(sampleDepthBilinear(Float32Array.of(1, 0, 3, 0), 2, 2, 0.5, 0.5)).toBeCloseTo(2, 6);
    expect(sampleDepthBilinear(Float32Array.of(1, 2, 3, 4), 2, 2, -5, -5)).toBe(0);
  });

  it('rejects frames whose pixel buffer does not match their size', () => {
    const p = new DepthTerrainProcessor(grid, calibration());
    const bad: DepthFrame = { width: 32, height: 24, timestampMs: 0, frameIndex: 0, depthMeters: new Float32Array(10) };
    expect(() => p.process(bad)).toThrow(RangeError);
    expect(() => p.resampleDepth({ ...bad, width: 0 })).toThrow(RangeError);
  });

  it('rebuilds the resampling map when the ROI changes', () => {
    const p = new DepthTerrainProcessor(grid, calibration(64, 24));
    const frame = makeFrame(64, 24, (x) => 1 + 0.001 * x);
    expect(p.resampleDepth(frame)[idx(0, 0)]).toBeCloseTo(1.0005, 5);
    p.setCalibration({ roiQuad: [{ x: 32, y: 0 }, { x: 64, y: 0 }, { x: 64, y: 24 }, { x: 32, y: 24 }] });
    expect(p.resampleDepth(frame)[idx(0, 0)]).toBeCloseTo(1.032, 5); // ROI now 1 px per cell: centre of pixel 32
  });
});
