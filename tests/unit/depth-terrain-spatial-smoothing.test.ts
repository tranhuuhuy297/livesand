// Spatial smoothing of published terrain: removes per-cell hysteresis/noise offsets that make contours jagged.
import { describe, expect, it } from 'vitest';
import { DepthTerrainProcessor, defaultDepthCalibration } from '../../src/core/depth-terrain-processor';
import { calibration, grid, idx, makeFrame, rng } from './depth-test-fixtures';

const W = 32, H = 24;
// Gentle slope: 0.2 cm of relief per cell (0.2 world units at 100 units/m).
const slope = (x: number): number => 1 - 0.002 * x;

/** Mean |second difference| of heights minus the true slope: 0 for perfectly smooth terrain. */
function roughness(heights: Float32Array): number {
  let sum = 0, n = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const lap = 4 * heights[idx(x, y)] - heights[idx(x - 1, y)] - heights[idx(x + 1, y)] - heights[idx(x, y - 1)] - heights[idx(x, y + 1)];
      sum += Math.abs(lap);
      n++;
    }
  }
  return sum / n;
}

function noisySlopeTerrain(spatialSigma: number): Float32Array {
  const p = new DepthTerrainProcessor(grid, calibration(W, H, { spatialSigma }));
  const rand = rng(11);
  let heights: Float32Array = new Float32Array(0);
  // +-4 mm sensor noise stays under the 0.5-unit hysteresis, so each cell freezes its own offset.
  for (let f = 0; f < 10; f++) heights = p.process(makeFrame(W, H, (x) => slope(x) + (rand() * 2 - 1) * 0.004)).heights;
  return heights;
}

describe('DepthTerrainProcessor spatial smoothing', () => {
  it('is on by default and validated', () => {
    expect(defaultDepthCalibration(grid, 256, 192).spatialSigma).toBe(1.5);
    const p = new DepthTerrainProcessor(grid, calibration());
    expect(() => p.setCalibration({ spatialSigma: -1 })).toThrow(RangeError);
    expect(() => p.setCalibration({ spatialSigma: 9 })).toThrow(RangeError);
    expect(() => p.setCalibration({ spatialSigma: Number.NaN })).toThrow(RangeError);
  });

  it('removes frozen per-cell noise from a gentle slope', () => {
    const rough = roughness(noisySlopeTerrain(0));
    const smooth = roughness(noisySlopeTerrain(1.5));
    expect(rough).toBeGreaterThan(0.3);
    expect(smooth).toBeLessThan(rough * 0.25);
  });

  it('keeps flat sand and the slope itself intact', () => {
    const p = new DepthTerrainProcessor(grid, calibration(W, H, { spatialSigma: 1.5 }));
    p.process(makeFrame(W, H, () => 1)).heights.forEach((h) => expect(Math.abs(h)).toBeLessThan(1e-5));
    const q = new DepthTerrainProcessor(grid, calibration(W, H, { spatialSigma: 1.5 }));
    const r = q.process(makeFrame(W, H, slope)).heights;
    expect(r[idx(16, 12)]).toBeCloseTo(3.2, 3); // linear ramps survive a symmetric blur
    expect(r[idx(0, 12)]).toBeLessThan(0.8); // renormalized at the border instead of darkened or smeared far
  });

  it('never lets cells without depth pull their neighbours toward the base height', () => {
    const p = new DepthTerrainProcessor(grid, calibration(W, H, { spatialSigma: 1.5 }));
    const r = p.process(makeFrame(W, H, (x) => (x < 16 ? 0.95 : 0))).heights; // right half invalid
    expect(r[idx(15, 12)]).toBeCloseTo(5, 4);
    expect(r[idx(17, 12)]).toBeCloseTo(5, 4); // hole next to sand is filled from the sand
    expect(r[idx(31, 12)]).toBe(0); // far from any sand: unchanged
  });

  it('keeps the published terrain frozen under a hand and re-publishes when the sigma changes', () => {
    const p = new DepthTerrainProcessor(grid, calibration(W, H, { spatialSigma: 1.5 }));
    const mound = (x: number, y: number) => 1 - 0.1 * Math.exp(-((x - 16) ** 2 + (y - 12) ** 2) / 20);
    const before = p.process(makeFrame(W, H, mound)).heights;
    const hand = p.process(makeFrame(W, H, (x, y) => (x >= 10 && x <= 14 && y >= 8 && y <= 11 ? 0.5 : mound(x, y))));
    expect(hand.changed).toBe(false);
    expect([...hand.heights]).toEqual([...before]);
    p.setCalibration({ spatialSigma: 0 });
    const raw = p.process(makeFrame(W, H, mound));
    expect(raw.changed).toBe(true);
    expect(raw.heights[idx(16, 12)]).toBeGreaterThan(before[idx(16, 12)]); // the blur had rounded the peak
  });
});
