import { describe, expect, it } from 'vitest';
import type { GridSize } from '../../src/core/types';
import { LAND_BASE_UNITS, mapPlaceHeights } from '../../src/game/real-place-height-mapping';
import { fillShallowHollows, spillLevels } from '../../src/game/real-place-hollow-filling';
import { borderConnectedLowCells, hasOpenSea } from '../../src/game/real-place-sea-detection';

const GRID: GridSize = { width: 64, height: 48 };
const field = (fn: (x: number, y: number) => number, grid = GRID) =>
  Float32Array.from({ length: grid.width * grid.height }, (_, i) => fn(i % grid.width, Math.floor(i / grid.width)));
// Deterministic +-1 hash: SRTM-like land roughness.
const noise = (x: number, y: number) => ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) * 2;
const ALL_OPEN = { north: true, east: true, south: true, west: true };

describe('sea or land below sea level', () => {
  it('finds the sea as a 0 m plateau (SRTM water) or as smooth bathymetry', () => {
    const plateau = field((x, y) => (x < 40 ? 5 + (40 - x) * 20 + noise(x, y) * 3 : 0));
    expect(hasOpenSea(plateau, GRID, 0.1)).toBe(true);
    const bathymetry = field((x, y) => (x < 40 ? 5 + (40 - x) * 20 + noise(x, y) * 3 : -2 - (x - 40) * 12));
    expect(hasOpenSea(bathymetry, GRID, 0.1)).toBe(true);
    expect(borderConnectedLowCells(bathymetry, GRID, 0.1)).toHaveLength(24 * 48);
  });

  it('keeps a desert basin with a flat playa below sea level as land (Death Valley)', () => {
    const basin = field((x, y) => {
      const d = Math.abs(x - 32);
      return d < 6 ? -80 : -80 + (d - 6) * 60 + noise(x, y) * 4;
    });
    expect(hasOpenSea(basin, GRID, 0.1)).toBe(false);
    const t = mapPlaceHeights({ meters: basin, grid: GRID, metersPerCell: 80, attribution: '' });
    expect(t.seaLevel).toBe(0);
    expect(t.minHeight).toBeCloseTo(LAND_BASE_UNITS, 5);
    expect(t.maxHeight - t.minHeight).toBeGreaterThan(20);
    expect(t.openEdges).toEqual(ALL_OPEN);
  });

  it('keeps polders behind a sea-level river as land', () => {
    const polders = field((x, y) => (y === 20 ? 0 : x < 20 ? 4 + noise(x, y) : -5 + noise(x, y) * 0.2));
    expect(hasOpenSea(polders, GRID, 0.1)).toBe(false);
  });

  it('keeps a rough map lying wholly below sea level as land (Qattara), but not islands in open or shallow seas', () => {
    const depression = field((x, y) => -130 + x * 1.5 + noise(x, y) * 6);
    expect(hasOpenSea(depression, GRID, 0.1)).toBe(false);
    const island = field((x, y) => {
      const r = Math.hypot(x - 32, y - 24);
      return r < 5 ? 300 - r * 50 : -40 - r * 4;
    });
    expect(hasOpenSea(island, GRID, 0.1)).toBe(true);
    // Phú Quốc: the Gulf of Thailand is a nearly flat, smooth floor a dozen metres down.
    const shallowSea = field((x, y) => (Math.hypot(x - 20, y - 24) < 12 ? 200 + noise(x, y) * 3 : -12 + x * 0.02));
    expect(hasOpenSea(shallowSea, GRID, 0.1)).toBe(true);
  });

  it('keeps a lake surface below sea level as land (the Dead Sea)', () => {
    const lake = field((x, y) => (x > 40 ? -415 : -415 + (41 - x) * 25 + noise(x, y) * 3));
    expect(hasOpenSea(lake, GRID, 0.1)).toBe(false);
  });

  it('ignores a few sea-level pixels that are rivers or data voids', () => {
    const hills = field((x, y) => (x === 0 && y < 3 ? 0 : 100 + x * 5 + noise(x, y)));
    expect(hasOpenSea(hills, GRID, 0.1)).toBe(false);
  });
});

describe('shallow hollow filling', () => {
  it('fills shallow closed hollows to their spill level and keeps deep ones', () => {
    // A gentle slope draining west with a few-metre pit and a 60 m crater.
    const m = field((x, y) => {
      if (Math.hypot(x - 20, y - 20) < 2) return 100 + x * 0.5 - 2;
      if (Math.hypot(x - 45, y - 25) < 5) return 100 + x * 0.5 - 60;
      return 100 + x * 0.5;
    });
    const out = fillShallowHollows(m, GRID, 5, -Infinity);
    const spill = spillLevels(out, GRID, -Infinity);
    expect(out[20 * 64 + 20]).toBe(109); // up to the lowest rim, on its downhill side
    for (let y = 16; y <= 24; y++) for (let x = 16; x <= 24; x++) expect(spill[y * 64 + x]).toBe(out[y * 64 + x]);
    expect(out[25 * 64 + 45]).toBe(m[25 * 64 + 45]);
    expect(out.every((v, i) => v >= m[i])).toBe(true);
  });

  it('lets sea cells drain the land around them and never raises them', () => {
    const m = field((x) => (x > 50 ? 0 : x === 30 ? 1 : 3));
    const out = fillShallowHollows(m, GRID, 5, 0.1);
    for (let y = 0; y < 48; y++) expect(out[y * 64 + 60]).toBe(0);
    expect(out[10 * 64 + 30]).toBe(1); // a trench reaching the map border drains out there
    expect(fillShallowHollows(m, GRID, 0, 0.1)).toEqual(m);
  });

  it('real-place mapping leaves no closed hollow shallower than about one world unit', () => {
    const plain = field((x, y) => 5 + x * 0.3 + noise(x, y) * 2.5);
    const t = mapPlaceHeights({ meters: plain, grid: GRID, metersPerCell: 55, attribution: '' });
    const spill = spillLevels(t.heights, GRID, -Infinity);
    let pooled = 0;
    for (let i = 0; i < spill.length; i++) if (spill[i] - t.heights[i] > 1e-3) pooled++;
    expect(pooled).toBe(0);
  });
});
