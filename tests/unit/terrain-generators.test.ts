import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID, type GridSize } from '../../src/core/types';
import { ValueNoise2D, mulberry32 } from '../../src/game/seeded-value-noise';
import {
  REFERENCE_RELIEF,
  cellToLayout,
  defaultRelief,
  generateTerrain,
  layoutToCell,
  type TerrainKind,
} from '../../src/game/terrain-generators';
import { applyTerrainOp, smoothstep } from '../../src/game/terrain-shaping-primitives';

const KINDS: TerrainKind[] = ['river-valley', 'twin-valleys', 'mountain-basin', 'volcano', 'flat'];
const SHAPED: TerrainKind[] = ['river-valley', 'twin-valleys', 'mountain-basin', 'volcano'];

function range(a: Float32Array): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of a) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return [lo, hi];
}

describe('seeded noise', () => {
  it('mulberry32 is deterministic per seed and stays in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const seqA = Array.from({ length: 1000 }, a);
    expect(seqA).toEqual(Array.from({ length: 1000 }, b));
    expect(seqA).not.toEqual(Array.from({ length: 1000 }, c));
    for (const x of seqA) expect(x >= 0 && x < 1).toBe(true);
    const mean = seqA.reduce((s, x) => s + x, 0) / seqA.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });

  it('value noise is deterministic, bounded and continuous', () => {
    const n1 = new ValueNoise2D(7);
    const n2 = new ValueNoise2D(7);
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37;
      const y = i * 0.61;
      const v = n1.fbm(x, y, 5);
      expect(v).toBe(n2.fbm(x, y, 5));
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(Math.abs(n1.sample(x + 1e-4, y) - n1.sample(x, y))).toBeLessThan(0.01);
    }
  });
});

describe('generateTerrain', () => {
  it.each(KINDS)('%s is deterministic for a seed', (kind) => {
    const a = generateTerrain(DEFAULT_GRID, { kind, seed: 99 });
    const b = generateTerrain(DEFAULT_GRID, { kind, seed: 99 });
    expect(a.length).toBe(DEFAULT_GRID.width * DEFAULT_GRID.height);
    expect(a).toEqual(b);
  });

  it.each(SHAPED)('%s changes with the seed but keeps its landform', (kind) => {
    const a = generateTerrain(DEFAULT_GRID, { kind, seed: 1 });
    const b = generateTerrain(DEFAULT_GRID, { kind, seed: 2 });
    let diff = 0;
    let maxDiff = 0;
    for (let i = 0; i < a.length; i++) {
      diff += Math.abs(a[i] - b[i]);
      maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
    }
    expect(diff / a.length).toBeGreaterThan(0.05);
    expect(maxDiff).toBeLessThan(REFERENCE_RELIEF * 0.2);
  });

  it.each(KINDS)('%s heights are finite and within [0, relief] with real relief', (kind) => {
    const h = generateTerrain(DEFAULT_GRID, { kind, seed: 5 });
    const [lo, hi] = range(h);
    expect(h.every(Number.isFinite)).toBe(true);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(REFERENCE_RELIEF);
    if (kind !== 'flat') expect(hi - lo).toBeGreaterThan(REFERENCE_RELIEF * 0.5);
  });

  it('flat is exactly flat', () => {
    const h = generateTerrain(DEFAULT_GRID, { kind: 'flat', seed: 3 });
    const [lo, hi] = range(h);
    expect(hi).toBe(lo);
    expect(lo).toBeGreaterThan(0);
  });

  it('scales relief with grid width and honours an explicit relief', () => {
    expect(defaultRelief(DEFAULT_GRID)).toBe(REFERENCE_RELIEF);
    const small: GridSize = { width: 128, height: 96 };
    expect(defaultRelief(small)).toBe(REFERENCE_RELIEF / 2);
    const [, hiSmall] = range(generateTerrain(small, { kind: 'mountain-basin', seed: 1 }));
    const [, hiBig] = range(generateTerrain(DEFAULT_GRID, { kind: 'mountain-basin', seed: 1 }));
    expect(hiSmall / hiBig).toBeCloseTo(0.5, 1);
    const [, hiCustom] = range(generateTerrain(DEFAULT_GRID, { kind: 'mountain-basin', seed: 1, relief: 10 }));
    expect(hiCustom).toBeLessThanOrEqual(10);
    expect(hiCustom).toBeGreaterThan(5);
  });

  it('puts open-edge seas at height 0 so dug trenches can drain', () => {
    const h = generateTerrain(DEFAULT_GRID, { kind: 'river-valley', seed: 1 });
    const { width, height } = DEFAULT_GRID;
    for (let y = 0; y < height; y++) expect(h[y * width + width - 1]).toBe(0);
  });

  it('works on tiny and odd grids', () => {
    for (const grid of [{ width: 1, height: 1 }, { width: 2, height: 3 }, { width: 17, height: 5 }]) {
      const h = generateTerrain(grid, { kind: 'twin-valleys', seed: 1 });
      expect(h.length).toBe(grid.width * grid.height);
      expect(h.every(Number.isFinite)).toBe(true);
    }
  });

  it('rejects invalid input', () => {
    expect(() => generateTerrain({ width: 0, height: 10 }, { kind: 'flat', seed: 1 })).toThrow(RangeError);
    expect(() => generateTerrain({ width: 10.5, height: 10 }, { kind: 'flat', seed: 1 })).toThrow(RangeError);
    expect(() => generateTerrain(DEFAULT_GRID, { kind: 'flat', seed: 1, relief: -1 })).toThrow(RangeError);
    expect(() => generateTerrain(DEFAULT_GRID, { kind: 'flat', seed: Number.NaN })).toThrow(RangeError);
    expect(() => generateTerrain(DEFAULT_GRID, { kind: 'glacier' as TerrainKind, seed: 1 })).toThrow(/Unknown terrain kind/);
  });
});

describe('layout helpers and carving primitives', () => {
  it('cellToLayout and layoutToCell are inverses', () => {
    for (const cells of [1, 2, 192, 256]) {
      for (const c of [0, cells - 1, Math.floor(cells / 2)]) expect(layoutToCell(cellToLayout(c, cells), cells)).toBeCloseTo(cells > 1 ? c : 0);
    }
    expect(cellToLayout(255, 256)).toBe(1);
  });

  it('smoothstep handles both edge orders', () => {
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(1, 0, 0)).toBe(1);
  });

  it('channel and bowl only carve, ridge only raises', () => {
    const channel = { kind: 'channel' as const, path: [{ u: 0, v: 0.5 }, { u: 1, v: 0.5 }], bed: [0.2, 0.1], halfWidth: 0.05, bank: 0.1 };
    expect(applyTerrainOp(0.5, 0.5, 0.5, 1, channel)).toBeCloseTo(0.15);
    expect(applyTerrainOp(0.05, 0.5, 0.5, 1, channel)).toBe(0.05);
    expect(applyTerrainOp(0.5, 0.5, 0.9, 1, channel)).toBe(0.5);
    const bowl = { kind: 'bowl' as const, center: { u: 0.5, v: 0.5 }, radius: 0.1, floor: 0.1, rim: 0.2 };
    expect(applyTerrainOp(0.5, 0.5, 0.5, 1, bowl)).toBeCloseTo(0.1);
    expect(applyTerrainOp(0.5, 0.6, 0.5, 1, bowl)).toBeCloseTo(0.3);
    const ridge = { kind: 'ridge' as const, path: [{ u: 0.5, v: 0 }, { u: 0.5, v: 1 }], crest: [0.8, 0.8], halfWidth: 0.05, drop: 0.2 };
    expect(applyTerrainOp(0.1, 0.5, 0.3, 1, ridge)).toBeCloseTo(0.8);
    expect(applyTerrainOp(0.9, 0.5, 0.3, 1, ridge)).toBe(0.9);
  });
});
