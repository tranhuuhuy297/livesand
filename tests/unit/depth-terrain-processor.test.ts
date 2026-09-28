import { describe, expect, it } from 'vitest';
import { DepthTerrainProcessor, defaultDepthCalibration } from '../../src/core/depth-terrain-processor';
import type { Quad } from '../../src/core/types';
import { calibration, flat, grid, idx, makeFrame, mound, rng } from './depth-test-fixtures';

describe('defaultDepthCalibration', () => {
  it('covers the whole depth image and yields a usable calibration', () => {
    const cal = defaultDepthCalibration(grid, 256, 192);
    expect(cal.roiQuad).toEqual([{ x: 0, y: 0 }, { x: 256, y: 0 }, { x: 256, y: 192 }, { x: 0, y: 192 }]);
    expect(cal.referenceDepth).toBeNull();
    expect(cal.unitsPerMeter).toBe(grid.width);
    expect(cal.minHeight).toBeLessThan(0);
    expect(cal.maxHeight).toBeGreaterThan(0);
    expect(cal.smoothing).toBeGreaterThan(0);
    expect(cal.smoothing).toBeLessThanOrEqual(1);
    expect(() => new DepthTerrainProcessor(grid, cal)).not.toThrow();
    expect(() => defaultDepthCalibration(grid, 0, 10)).toThrow(RangeError);
    expect(() => defaultDepthCalibration({ width: 0, height: 4 }, 10, 10)).toThrow(RangeError);
  });
});

describe('DepthTerrainProcessor.process', () => {
  it('turns flat sand at the reference distance into ~0 heights on the first frame', () => {
    const p = new DepthTerrainProcessor(grid, calibration());
    const r = p.process(makeFrame(32, 24, flat));
    expect(r.changed).toBe(true);
    expect(r.heights).toHaveLength(grid.width * grid.height);
    r.heights.forEach((h) => expect(Math.abs(h)).toBeLessThan(1e-4));
    expect(r.handMask.every((m) => m === 0)).toBe(true);
  });

  it('turns a mound into positive heights and clamps to min/max', () => {
    const p = new DepthTerrainProcessor(grid, calibration());
    const r = p.process(makeFrame(32, 24, mound));
    expect(r.heights[idx(16, 12)]).toBeCloseTo(10, 3);
    expect(r.heights[idx(0, 0)]).toBeLessThan(0.01);
    expect(r.heights[idx(16, 12)]).toBeGreaterThan(r.heights[idx(19, 12)]);
    const q = new DepthTerrainProcessor(grid, calibration());
    const clamped = q.process(makeFrame(32, 24, (x) => (x < 16 ? 0.78 : 1.2)));
    expect(clamped.heights[idx(2, 2)]).toBe(20);
    expect(clamped.heights[idx(30, 2)]).toBe(-10);
    expect(clamped.handMask.every((m) => m === 0)).toBe(true);
  });

  it('masks a hovering hand and keeps the terrain under it unchanged', () => {
    const p = new DepthTerrainProcessor(grid, calibration());
    const before = p.process(makeFrame(32, 24, mound)).heights;
    const inHand = (x: number, y: number): boolean => x >= 10 && x <= 14 && y >= 8 && y <= 11;
    const r = p.process(makeFrame(32, 24, (x, y) => (inHand(x, y) ? 0.5 : mound(x, y))));
    expect(r.handMask[idx(12, 10)]).toBe(1);
    expect(r.handMask[idx(9, 7)]).toBe(1); // one-cell dilation hides blended edge samples
    expect(r.handMask[idx(20, 20)]).toBe(0);
    expect(r.handMask[idx(16, 10)]).toBe(0);
    expect([...r.heights]).toEqual([...before]);
    expect(r.changed).toBe(false);
    const gone = p.process(makeFrame(32, 24, mound));
    expect(gone.handMask.every((m) => m === 0)).toBe(true);
  });

  it('keeps previous heights where depth is invalid', () => {
    const p = new DepthTerrainProcessor(grid, calibration());
    const before = p.process(makeFrame(32, 24, mound)).heights;
    const r = p.process(makeFrame(32, 24, (x, y) => (x >= 12 && x <= 20 ? 0 : mound(x, y))));
    expect(r.heights[idx(16, 12)]).toBe(before[idx(16, 12)]);
    expect([...r.heights]).toEqual([...before]);
    expect(r.handMask[idx(16, 12)]).toBe(0);
  });

  it('ignores sensor noise below the change threshold', () => {
    const p = new DepthTerrainProcessor(grid, calibration());
    const first = p.process(makeFrame(32, 24, flat)).heights;
    const rand = rng(7);
    for (let f = 0; f < 20; f++) {
      // +-4 mm = +-0.4 world units, below the 0.5 threshold.
      const r = p.process(makeFrame(32, 24, () => 1 + (rand() * 2 - 1) * 0.004));
      expect(r.changed).toBe(false);
      expect([...r.heights]).toEqual([...first]);
    }
  });

  it('eases real changes in with the EMA and converges', () => {
    const p = new DepthTerrainProcessor(grid, calibration());
    p.process(makeFrame(32, 24, flat));
    const raised = makeFrame(32, 24, () => 0.95); // +5 cm = 5 units
    const second = p.process(raised);
    expect(second.changed).toBe(true);
    expect(second.heights[idx(3, 3)]).toBeCloseTo(2.5, 4);
    let last = second;
    for (let f = 0; f < 20; f++) last = p.process(raised);
    expect(last.heights[idx(3, 3)]).toBeGreaterThan(4.5);
    expect(last.heights[idx(3, 3)]).toBeLessThanOrEqual(5 + 1e-4);
  });

  it('returns copies so callers cannot corrupt the filter state', () => {
    const p = new DepthTerrainProcessor(grid, calibration());
    const r = p.process(makeFrame(32, 24, mound));
    r.heights.fill(99);
    r.handMask.fill(1);
    const again = p.process(makeFrame(32, 24, mound));
    expect(again.heights[idx(16, 12)]).toBeCloseTo(10, 3);
    expect(again.handMask[idx(16, 12)]).toBe(0);
  });
});

describe('reference capture and calibration updates', () => {
  it('captures a tilted flat-sand reference so the same sand reads as ~0', () => {
    const p = new DepthTerrainProcessor(grid, calibration());
    const tilted = (x: number): number => 0.9 + 0.004 * x;
    const ref = p.captureReference(makeFrame(32, 24, (x, y) => (x === 3 && y === 3 ? 0 : tilted(x))));
    expect(ref).toHaveLength(grid.width * grid.height);
    expect(ref.every((d) => d > 0)).toBe(true); // hole filled with the mean
    expect(p.calibration.referenceDepth).not.toBeNull();
    // First frame after a capture seeds directly (no EMA lag).
    const dug = p.process(makeFrame(32, 24, (x) => tilted(x) + 0.03));
    expect(dug.heights[idx(20, 5)]).toBeCloseTo(-3, 2);
    p.captureReference(makeFrame(32, 24, tilted));
    p.process(makeFrame(32, 24, tilted)).heights.forEach((h) => expect(Math.abs(h)).toBeLessThan(1e-3));
    expect(() => p.captureReference(makeFrame(32, 24, () => 0))).toThrow(/no valid depth/);
  });

  it('re-seeds heights directly after a reference change instead of easing', () => {
    const p = new DepthTerrainProcessor(grid, calibration());
    p.process(makeFrame(32, 24, flat));
    p.setCalibration({ referencePlaneMeters: 1.05 });
    const r = p.process(makeFrame(32, 24, flat));
    expect(r.changed).toBe(true);
    expect(r.heights[idx(5, 5)]).toBeCloseTo(5, 3);
  });

  it('validates patches atomically and exposes a defensive copy', () => {
    const p = new DepthTerrainProcessor(grid, calibration());
    const degenerate: Quad = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }, { x: 0, y: 20 }];
    expect(() => p.setCalibration({ roiQuad: degenerate })).toThrow(/degenerate/);
    expect(() => p.setCalibration({ referenceDepth: new Float32Array(5) })).toThrow(RangeError);
    expect(() => p.setCalibration({ smoothing: 2 })).toThrow(RangeError);
    expect(() => p.setCalibration({ minHeight: 30 })).toThrow(RangeError);
    expect(p.calibration.smoothing).toBe(0.5);
    p.setCalibration({ smoothing: 0.25, changeThreshold: undefined });
    expect(p.calibration.smoothing).toBe(0.25);
    expect(p.calibration.changeThreshold).toBe(0.5);
    const copy = p.calibration;
    copy.roiQuad[1].x = 1;
    expect(p.calibration.roiQuad[1].x).toBe(32);
    expect(() => new DepthTerrainProcessor(grid, calibration(32, 24, { roiQuad: degenerate }))).toThrow(/degenerate/);
  });
});
