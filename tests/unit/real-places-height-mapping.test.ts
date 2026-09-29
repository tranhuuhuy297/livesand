import { describe, expect, it } from 'vitest';
import type { GridSize } from '../../src/core/types';
import { fillInlandSeaSpecks, removeElevationSpikes, smoothLandElevation, spikeMarginMeters } from '../../src/game/real-place-elevation-cleanup';
import {
  LAND_BASE_UNITS,
  MAX_AUTO_EXAGGERATION,
  MIN_AUTO_EXAGGERATION,
  TARGET_LAND_RELIEF_UNITS,
  autoVerticalExaggeration,
  mapPlaceHeights,
  noiseSmoothingPasses,
  oceanOpenEdges,
} from '../../src/game/real-place-height-mapping';

const GRID: GridSize = { width: 64, height: 48 };
const field = (fn: (x: number, y: number) => number, grid = GRID) =>
  Float32Array.from({ length: grid.width * grid.height }, (_, i) => fn(i % grid.width, Math.floor(i / grid.width)));
const range = (a: Float32Array) => [Math.min(...a), Math.max(...a)];

describe('real place height mapping', () => {
  // West: land ramping up to 600 m; east third: sea with bathymetry down to -40 m.
  const coast = field((x) => (x < 42 ? ((42 - x) / 42) * 600 : -((x - 42) / 21) * 40));

  it('puts sea level at LAND_BASE_UNITS on coastal maps, land above it and the sea floor between 0 and sea level', () => {
    const t = mapPlaceHeights({ meters: coast, grid: GRID, metersPerCell: 100, attribution: 'test' });
    expect(t.seaLevel).toBe(LAND_BASE_UNITS);
    expect(t.metersPerUnitVertical).toBeCloseTo(600 / TARGET_LAND_RELIEF_UNITS, 6);
    expect(t.maxHeight).toBeCloseTo(LAND_BASE_UNITS + TARGET_LAND_RELIEF_UNITS, 3);
    expect(t.minHeight).toBeGreaterThanOrEqual(0);
    for (let y = 0; y < GRID.height; y++) {
      expect(t.heights[y * GRID.width + 10]).toBeGreaterThan(t.seaLevel);
      expect(t.heights[y * GRID.width + 50]).toBeLessThanOrEqual(t.seaLevel - 0.5);
    }
    expect(t.openEdges).toEqual({ north: true, east: true, south: true, west: false });
    expect(t.metersPerCell).toBe(100);
    expect(t.attribution).toBe('test');
  });

  it('maps inland maps from their lowest point, with no sea and every edge open so rivers can leave', () => {
    const hills = field((x, y) => 500 + 10 * x + 5 * y);
    const t = mapPlaceHeights({ meters: hills, grid: GRID, metersPerCell: 60, attribution: '' });
    expect(t.seaLevel).toBe(0);
    expect(t.minHeight).toBeCloseTo(LAND_BASE_UNITS, 5);
    expect(t.maxHeight).toBeCloseTo(LAND_BASE_UNITS + TARGET_LAND_RELIEF_UNITS, 3);
    expect(t.openEdges).toEqual({ north: true, east: true, south: true, west: true });
  });

  it('clamps automatic exaggeration and honours an explicit override', () => {
    expect(autoVerticalExaggeration(0, 50)).toBe(MAX_AUTO_EXAGGERATION);
    expect(autoVerticalExaggeration(5, 50)).toBe(MAX_AUTO_EXAGGERATION);
    expect(autoVerticalExaggeration(1e6, 50)).toBe(MIN_AUTO_EXAGGERATION);
    expect(autoVerticalExaggeration(3000, 100)).toBeCloseTo(1, 9);
    const flatDelta = field((x) => (x < 32 ? 1 + (x % 3) : 0));
    const auto = mapPlaceHeights({ meters: flatDelta, grid: GRID, metersPerCell: 50, attribution: '' });
    expect(auto.metersPerCell / auto.metersPerUnitVertical).toBeCloseTo(MAX_AUTO_EXAGGERATION, 9);
    const manual = mapPlaceHeights({ meters: coast, grid: GRID, metersPerCell: 100, verticalExaggeration: 2, attribution: '' });
    expect(manual.metersPerUnitVertical).toBe(50);
    expect(manual.maxHeight).toBeCloseTo(LAND_BASE_UNITS + 12, 3);
    expect(() => mapPlaceHeights({ meters: coast, grid: GRID, metersPerCell: 100, verticalExaggeration: 0, attribution: '' })).toThrow(RangeError);
  });

  it('rejects mismatched sizes and non-finite data', () => {
    expect(() => mapPlaceHeights({ meters: new Float32Array(3), grid: GRID, metersPerCell: 1, attribution: '' })).toThrow(RangeError);
    expect(() => mapPlaceHeights({ meters: coast, grid: GRID, metersPerCell: 0, attribution: '' })).toThrow(RangeError);
    const bad = coast.slice();
    bad[5] = NaN;
    expect(() => mapPlaceHeights({ meters: bad, grid: GRID, metersPerCell: 1, attribution: '' })).toThrow(/non-finite/);
  });

  it('opens an edge only when enough of its border is ocean', () => {
    const grid = { width: 40, height: 30 };
    const h = new Float32Array(40 * 30).fill(5);
    h[0] = 0; // one sea cell in the north-west corner is not a coast
    for (let x = 30; x < 40; x++) h[29 * 40 + x] = 0;
    expect(oceanOpenEdges(h, grid, 2)).toEqual({ north: false, east: false, south: true, west: false });
  });

  it('smooths more as the vertical scale magnifies DEM noise', () => {
    expect(noiseSmoothingPasses(50)).toBe(0);
    expect(noiseSmoothingPasses(4)).toBe(2);
    expect(noiseSmoothingPasses(2)).toBe(4);
  });
});

describe('elevation cleanup', () => {
  it('removes isolated spikes and pits but keeps cliffs and cone peaks', () => {
    const grid = { width: 32, height: 32 };
    const cliff = (x: number) => (x < 16 ? 300 : 100);
    const cone = (x: number, y: number) => Math.max(0, 400 - 60 * Math.hypot(x - 8, y - 24));
    const m = field((x, y) => cliff(x) + cone(x, y), grid);
    const clean = m.slice();
    m[5 * 32 + 25] += 900; // spike on the low plateau
    m[6 * 32 + 25] += 700; // adjacent second spike
    m[20 * 32 + 22] -= 600; // pit
    expect(spikeMarginMeters(m)).toBeGreaterThan(30);
    const replaced = removeElevationSpikes(m, grid);
    expect(replaced).toBe(3);
    for (let i = 0; i < m.length; i++) expect(m[i]).toBeCloseTo(clean[i], 3);
  });

  it('leaves a clean mountain untouched', () => {
    const grid = { width: 24, height: 24 };
    const m = field((x, y) => 3000 - 180 * Math.hypot(x - 12, y - 12), grid);
    expect(removeElevationSpikes(m, grid)).toBe(0);
  });

  it('blurs land only, keeping sea-level channels crisp', () => {
    const grid = { width: 16, height: 16 };
    const m = field((x, y) => (x === 8 ? 0 : 5 + ((x * 7 + y * 13) % 5)), grid);
    const out = smoothLandElevation(m, grid, 2, 0.1);
    for (let y = 0; y < 16; y++) expect(out[y * 16 + 8]).toBe(0);
    const spread = (a: Float32Array) => {
      const land = Array.from(a).filter((_, i) => i % 16 !== 8);
      return Math.max(...land) - Math.min(...land);
    };
    expect(spread(out)).toBeLessThan(spread(m));
    expect(Math.min(...Array.from(out).filter((_, i) => i % 16 !== 8))).toBeGreaterThan(0.1);
  });

  it('turns small inland sea specks into low land but keeps real water bodies', () => {
    const grid = { width: 30, height: 20 };
    const m = field((x, y) => {
      if (x >= 25) return 0; // sea on the east border
      if (x === 5 && y === 5) return 0; // pond speck
      if (x >= 10 && x < 18 && y >= 8 && y < 14) return 0; // 48-cell lagoon
      return 4;
    }, grid);
    const out = fillInlandSeaSpecks(m, grid, 0.1, 24);
    expect(out[5 * 30 + 5]).toBeGreaterThan(0.1);
    expect(out[10 * 30 + 12]).toBe(0);
    expect(out[3 * 30 + 27]).toBe(0);
    expect(range(out)).toEqual([0, 4]);
  });
});
