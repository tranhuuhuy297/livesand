import { describe, expect, it } from 'vitest';
import {
  CALIBRATION_STORAGE_KEY,
  CalibrationFormatError,
  clearCalibration,
  loadCalibration,
  parseCalibration,
  saveCalibration,
  serializeCalibration,
  type CalibrationStorage,
} from '../../src/app/physical/calibration-storage';
import { base64ToFloat32, float32ToBase64 } from '../../src/app/physical/float32-base64-codec';
import {
  heightRangeOf,
  identityKeystone,
  reliefToHeights,
  toDepthCalibration,
  type PhysicalCalibration,
} from '../../src/app/physical/physical-calibration-model';
import type { GridSize } from '../../src/core/types';

const GRID: GridSize = { width: 32, height: 24 };

/** Map-backed Storage double; `failWrites` simulates a full quota. */
function memoryStorage(failWrites = false): CalibrationStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      if (failWrites) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
      map.set(k, v);
    },
    removeItem: (k) => void map.delete(k),
  };
}

function sampleCalibration(withReference = true): PhysicalCalibration {
  const reference = new Float32Array(GRID.width * GRID.height);
  for (let i = 0; i < reference.length; i++) reference[i] = 0.95 + (i % 7) * 0.0123456789;
  reference[5] = 0; // invalid cell falls back to the plane
  return {
    grid: { ...GRID },
    depthWidth: 256,
    depthHeight: 192,
    roiQuad: [{ x: 20.5, y: 10 }, { x: 230, y: 14.25 }, { x: 236, y: 180 }, { x: 16, y: 176 }],
    referenceDepth: withReference ? reference : null,
    referencePlaneMeters: 1.002,
    boxWidthCm: 80,
    ...reliefToHeights(GRID, 80, 10, 20),
    keystone: [{ x: 0.02, y: 0.01 }, { x: 0.97, y: 0.03 }, { x: 1.01, y: 0.99 }, { x: -0.01, y: 0.96 }],
    savedAt: 1_790_000_000_000,
  };
}

function mutate(cal: PhysicalCalibration, patch: (obj: Record<string, unknown>) => void): string {
  const obj = JSON.parse(serializeCalibration(cal)) as Record<string, unknown>;
  patch(obj);
  return JSON.stringify(obj);
}

describe('float32 base64 codec', () => {
  it('round-trips values bit-exactly, including edge values', () => {
    const values = Float32Array.of(0, -0, 1.5, -3.25, 1e-30, 3.4e38, Math.PI, Number.MIN_VALUE);
    const back = base64ToFloat32(float32ToBase64(values));
    expect(Array.from(back)).toEqual(Array.from(values));
    expect(Object.is(back[1], -0)).toBe(true);
  });

  it('handles arrays larger than one encoding chunk', () => {
    const values = new Float32Array(50_000).map((_, i) => i * 0.5);
    expect(base64ToFloat32(float32ToBase64(values))).toEqual(values);
  });

  it('rejects malformed input', () => {
    expect(() => base64ToFloat32('***')).toThrow(RangeError);
    expect(() => base64ToFloat32(btoa('abc'))).toThrow(/multiple of 4/);
  });
});

describe('calibration storage', () => {
  it('saves and loads a calibration with per-cell reference depth', () => {
    const storage = memoryStorage();
    const cal = sampleCalibration();
    saveCalibration(cal, storage);
    expect(storage.map.has(CALIBRATION_STORAGE_KEY)).toBe(true);
    const loaded = loadCalibration(GRID, storage);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.calibration).toEqual(cal);
    expect(loaded.calibration.referenceDepth).toBeInstanceOf(Float32Array);
  });

  it('round-trips a plane-only calibration (no reference depth)', () => {
    const cal = sampleCalibration(false);
    expect(parseCalibration(serializeCalibration(cal), GRID)).toEqual(cal);
  });

  it('reports a missing calibration and unavailable storage', () => {
    expect(loadCalibration(GRID, memoryStorage())).toEqual({ ok: false, missing: true, reason: 'no saved calibration' });
    const none = loadCalibration(GRID, null);
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.missing).toBe(true);
    const throwing: CalibrationStorage = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(loadCalibration(GRID, throwing)).toMatchObject({ ok: false, missing: true });
  });

  it('rejects other format versions, grids and corrupted JSON', () => {
    const cal = sampleCalibration();
    expect(() => parseCalibration(mutate(cal, (o) => (o.version = 2)), GRID)).toThrow(/format version 2/);
    expect(() => parseCalibration(serializeCalibration(cal), { width: 64, height: 48 })).toThrow(/32x24 grid/);
    expect(() => parseCalibration('{not json', GRID)).toThrow(CalibrationFormatError);
    expect(() => parseCalibration('null', GRID)).toThrow(/not an object/);
    const storage = memoryStorage();
    storage.setItem(CALIBRATION_STORAGE_KEY, '{"version":1');
    const loaded = loadCalibration(GRID, storage);
    expect(loaded).toMatchObject({ ok: false, missing: false });
  });

  it('rejects invalid numbers, quads and reference data', () => {
    const cal = sampleCalibration();
    const bad: [string, (o: Record<string, unknown>) => void, RegExp][] = [
      ['depth size', (o) => (o.depthWidth = 0), /depthWidth/],
      ['fractional depth size', (o) => (o.depthHeight = 191.5), /depthHeight/],
      ['plane', (o) => (o.referencePlaneMeters = -1), /referencePlaneMeters/],
      ['units', (o) => (o.unitsPerMeter = 'x'), /unitsPerMeter/],
      ['min above flat sand', (o) => (o.minHeight = 3), /minHeight/],
      ['max not positive', (o) => (o.maxHeight = 0), /maxHeight/],
      ['bow-tie ROI', (o) => (o.roiQuad = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }]), /roiQuad/],
      ['3-corner keystone', (o) => (o.keystone = identityKeystone().slice(0, 3)), /keystone/],
      ['non-finite corner', (o) => (o.keystone = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: null }, { x: 0, y: 1 }]), /keystone/],
      ['short reference', (o) => (o.referenceDepthBase64 = float32ToBase64(new Float32Array(10))), /expected 768/],
      ['corrupt reference', (o) => (o.referenceDepthBase64 = '@@@'), /corrupt/],
      ['NaN reference', (o) => (o.referenceDepthBase64 = float32ToBase64(new Float32Array(768).fill(Number.NaN))), /invalid values/],
    ];
    for (const [label, patch, message] of bad) {
      expect(() => parseCalibration(mutate(cal, patch), GRID), label).toThrow(message);
    }
  });

  it('turns storage write failures into a readable error', () => {
    expect(() => saveCalibration(sampleCalibration(), memoryStorage(true))).toThrow(/QuotaExceededError/);
    expect(() => saveCalibration(sampleCalibration(), null)).toThrow(/unavailable/);
  });

  it('clears the saved calibration', () => {
    const storage = memoryStorage();
    saveCalibration(sampleCalibration(), storage);
    clearCalibration(storage);
    expect(loadCalibration(GRID, storage)).toMatchObject({ ok: false, missing: true });
    expect(() => clearCalibration(null)).not.toThrow();
  });
});

describe('processor calibration mapping', () => {
  it('shifts the datum so dug sand is 0 and flat sand sits at the dig depth', () => {
    const cal = sampleCalibration();
    const upm = GRID.width / 0.8;
    expect(cal.unitsPerMeter).toBeCloseTo(upm);
    expect(cal.minHeight).toBeCloseTo(-0.1 * upm);
    expect(cal.maxHeight).toBeCloseTo(0.2 * upm);
    const range = heightRangeOf(cal);
    expect(range.min).toBe(0);
    expect(range.flat).toBeCloseTo(0.1 * upm);
    expect(range.max).toBeCloseTo(0.3 * upm);

    const depthCal = toDepthCalibration(cal);
    expect(depthCal.minHeight).toBe(0);
    expect(depthCal.maxHeight).toBeCloseTo(range.max);
    expect(depthCal.referencePlaneMeters).toBeCloseTo(1.002 + 0.1);
    const ref = cal.referenceDepth as Float32Array;
    const shifted = depthCal.referenceDepth as Float32Array;
    expect(shifted[0]).toBeCloseTo(ref[0] + 0.1, 6);
    expect(shifted[5]).toBe(0); // invalid cells stay invalid
    // Flat sand (depth == reference) maps to the flat height.
    expect((shifted[0] - ref[0]) * depthCal.unitsPerMeter).toBeCloseTo(range.flat, 3);
  });
});
