import { describe, expect, it } from 'vitest';
import type { GridSize } from '../../src/core/types';
import { buildVillageSculptFloor } from '../../src/game/village-sculpt-floor';
import { STROKE_REFERENCE_SPEED, applySculptBrush, applySculptStroke, brushFalloff, paintRainBrush } from '../../src/input/sculpt-tools';

const GRID: GridSize = { width: 40, height: 30 };
const BOUNDS = { min: 0, max: 20 };
const idx = (x: number, y: number) => y * GRID.width + x;
const flat = (h = 5) => new Float32Array(GRID.width * GRID.height).fill(h);
const brush = { radius: 6, strength: 10 };

describe('brushFalloff', () => {
  it('is a smooth cosine bell from 1 at the centre to 0 at the rim', () => {
    expect(brushFalloff(0, 4)).toBe(1);
    expect(brushFalloff(2, 4)).toBeCloseTo(0.5);
    expect(brushFalloff(4, 4)).toBe(0);
    expect(brushFalloff(9, 4)).toBe(0);
    expect(brushFalloff(0, 0)).toBe(0);
    expect(brushFalloff(1, 4)).toBeGreaterThan(brushFalloff(3, 4));
  });
});

describe('applySculptBrush', () => {
  it('raise adds strength*dt at the centre with falloff, symmetric, nothing beyond the radius', () => {
    const h = flat();
    expect(applySculptBrush(h, GRID, 20, 15, 'raise', brush, 0.1, BOUNDS)).toBe(true);
    expect(h[idx(20, 15)]).toBeCloseTo(6);
    expect(h[idx(23, 15)]).toBeCloseTo(5 + 1 * brushFalloff(3, 6));
    expect(h[idx(17, 15)]).toBeCloseTo(h[idx(23, 15)]);
    expect(h[idx(20, 18)]).toBeCloseTo(h[idx(23, 15)]);
    expect(h[idx(26, 15)]).toBe(5);
    expect(h[idx(0, 0)]).toBe(5);
  });

  it('lower subtracts and clamps at the minimum; no change reported once clamped', () => {
    const h = flat(0.5);
    expect(applySculptBrush(h, GRID, 20, 15, 'lower', brush, 1, BOUNDS)).toBe(true);
    expect(h[idx(20, 15)]).toBe(0);
    expect(Math.min(...h)).toBeGreaterThanOrEqual(0);
    const small = { radius: 2, strength: 10 };
    const g = flat(0);
    expect(applySculptBrush(g, GRID, 20, 15, 'lower', small, 1, BOUNDS)).toBe(false);
  });

  it('raise clamps at the maximum; non-finite bounds mean unbounded', () => {
    const h = flat(19.5);
    applySculptBrush(h, GRID, 20, 15, 'raise', brush, 1, BOUNDS);
    expect(Math.max(...h)).toBe(20);
    applySculptBrush(h, GRID, 20, 15, 'raise', brush, 1, { min: 0, max: Number.NaN });
    expect(h[idx(20, 15)]).toBe(30);
    expect(h.every(Number.isFinite)).toBe(true);
  });

  it('smooth pulls a spike toward its neighbourhood without touching flat ground', () => {
    const h = flat();
    h[idx(20, 15)] = 14;
    expect(applySculptBrush(h, GRID, 20, 15, 'smooth', brush, 0.05, BOUNDS)).toBe(true);
    // 3x3 average around the spike is 6, blend factor strength*dt = 0.5.
    expect(h[idx(20, 15)]).toBeCloseTo(10);
    expect(h[idx(21, 15)]).toBeGreaterThan(5);
    expect(h[idx(30, 15)]).toBe(5);
    const g = flat();
    expect(applySculptBrush(g, GRID, 20, 15, 'smooth', brush, 0.05, BOUNDS)).toBe(false);
  });

  it('smooth never overshoots the local average even with a huge step', () => {
    const h = flat();
    h[idx(20, 15)] = 14;
    applySculptBrush(h, GRID, 20, 15, 'smooth', { radius: 6, strength: 1000 }, 1, BOUNDS);
    expect(h[idx(20, 15)]).toBeCloseTo(6);
  });

  it('flatten moves toward the target without overshooting', () => {
    const h = flat();
    h[idx(20, 15)] = 9;
    applySculptBrush(h, GRID, 20, 15, 'flatten', brush, 0.1, BOUNDS, 7);
    expect(h[idx(20, 15)]).toBeCloseTo(8);
    expect(h[idx(22, 15)]).toBeGreaterThan(5);
    expect(h[idx(22, 15)]).toBeLessThanOrEqual(7);
    for (let i = 0; i < 50; i++) applySculptBrush(h, GRID, 20, 15, 'flatten', brush, 0.1, BOUNDS, 7);
    expect(h[idx(20, 15)]).toBeCloseTo(7);
    expect(h[idx(23, 15)]).toBeCloseTo(7);
  });

  it('flatten defaults to the height under the brush centre', () => {
    const h = flat();
    for (let x = 0; x < GRID.width; x++) h[idx(x, 15)] = 5 + x * 0.1;
    const centre = h[idx(20, 15)];
    for (let i = 0; i < 100; i++) applySculptBrush(h, GRID, 20, 15, 'flatten', brush, 0.1, BOUNDS);
    expect(h[idx(22, 15)]).toBeCloseTo(centre, 3);
    expect(h[idx(18, 15)]).toBeCloseTo(centre, 3);
  });

  it('handles brushes at or beyond the grid edge', () => {
    const h = flat();
    expect(applySculptBrush(h, GRID, 0, 0, 'raise', brush, 0.1, BOUNDS)).toBe(true);
    expect(h[idx(0, 0)]).toBeCloseTo(6);
    expect(applySculptBrush(h, GRID, -50, 10, 'raise', brush, 0.1, BOUNDS)).toBe(false);
    expect(applySculptBrush(h, GRID, 20, 1000, 'raise', brush, 0.1, BOUNDS)).toBe(false);
  });

  it('ignores invalid steps and rejects mismatched arrays', () => {
    const h = flat();
    for (const [dt, b] of [[0, brush], [-1, brush], [Number.NaN, brush], [0.1, { radius: 0, strength: 5 }], [0.1, { radius: 5, strength: -5 }]] as const) {
      expect(applySculptBrush(h, GRID, 20, 15, 'raise', b, dt, BOUNDS)).toBe(false);
    }
    expect(applySculptBrush(h, GRID, Number.NaN, 15, 'raise', brush, 0.1, BOUNDS)).toBe(false);
    expect(h.every((v) => v === 5)).toBe(true);
    expect(() => applySculptBrush(new Float32Array(3), GRID, 1, 1, 'raise', brush, 0.1, BOUNDS)).toThrow(RangeError);
  });
});

describe('applySculptStroke', () => {
  /** Drags a lower brush from x=8 to x=32 along y=15 at `speed` cells/s in frames of `dt`, returning the heights. */
  const drag = (speed: number, dt: number): Float32Array => {
    const h = flat(10);
    let last: { x: number; y: number } | null = null;
    const frames = Math.ceil(24 / (speed * dt));
    for (let i = 0; i <= frames; i++) {
      const at = { x: 8 + (24 * i) / frames, y: 15 };
      applySculptStroke(h, GRID, last, at, 'lower', brush, dt, BOUNDS);
      last = at;
    }
    return h;
  };

  it('carves the same channel for a quick swipe as for a drag at the reference speed', () => {
    const ref = drag(STROKE_REFERENCE_SPEED, 1 / 60);
    const swipe = drag(STROKE_REFERENCE_SPEED * 6, 1 / 60);
    const lowFps = drag(STROKE_REFERENCE_SPEED * 6, 1 / 8);
    expect(10 - ref[idx(20, 15)]).toBeGreaterThan(3);
    expect(swipe[idx(20, 15)]).toBeCloseTo(ref[idx(20, 15)], 0);
    expect(lowFps[idx(20, 15)]).toBeCloseTo(ref[idx(20, 15)], 0);
    // No gaps between low-fps stamps along the path.
    for (let x = 12; x <= 28; x++) expect(10 - lowFps[idx(x, 15)]).toBeGreaterThan(3);
  });

  it('keeps time-based digging when holding still or dragging slowly, and treats long jumps as a single stamp', () => {
    const still = flat(10);
    expect(applySculptStroke(still, GRID, null, { x: 20, y: 15 }, 'lower', brush, 0.1, BOUNDS)).toBe(true);
    expect(still[idx(20, 15)]).toBeCloseTo(9);
    const slow = flat(10);
    applySculptStroke(slow, GRID, { x: 20, y: 15 }, { x: 20.1, y: 15 }, 'lower', brush, 0.1, BOUNDS);
    expect(slow[idx(20, 15)]).toBeCloseTo(9, 1);
    const jump = flat(10);
    applySculptStroke(jump, GRID, { x: -60, y: 15 }, { x: 20, y: 15 }, 'lower', brush, 0.1, BOUNDS);
    expect(jump[idx(20, 15)]).toBeCloseTo(9);
    expect(jump[idx(8, 15)]).toBe(10);
  });

  it('never digs village ground below its floor but still lets it be built up', () => {
    const h = flat(10);
    const floor = buildVillageSculptFloor(h, GRID, [{ x: 20, y: 15, radius: 3 }]);
    expect(floor).not.toBeNull();
    expect(buildVillageSculptFloor(h, GRID, [])).toBeNull();
    const bounds = { ...BOUNDS, floor };
    applySculptStroke(h, GRID, { x: 8, y: 15 }, { x: 32, y: 15 }, 'lower', brush, 1, bounds);
    expect(h[idx(20, 15)]).toBe(10);
    expect(h[idx(24, 15)]).toBe(10);
    expect(h[idx(12, 15)]).toBeLessThan(9);
    applySculptBrush(h, GRID, 20, 15, 'raise', brush, 0.1, bounds);
    expect(h[idx(20, 15)]).toBeCloseTo(11);
    applySculptBrush(h, GRID, 20, 15, 'lower', brush, 5, bounds);
    expect(h[idx(20, 15)]).toBe(10);
  });
});

describe('paintRainBrush', () => {
  it('paints rate with falloff and keeps the max instead of stacking', () => {
    const f = new Float32Array(GRID.width * GRID.height);
    paintRainBrush(f, GRID, 20, 15, 5, 2);
    expect(f[idx(20, 15)]).toBe(2);
    expect(f[idx(22, 15)]).toBeCloseTo(2 * brushFalloff(2, 5));
    expect(f[idx(26, 15)]).toBe(0);
    paintRainBrush(f, GRID, 20, 15, 5, 2);
    expect(f[idx(20, 15)]).toBe(2);
    paintRainBrush(f, GRID, 21, 15, 5, 1);
    expect(f[idx(20, 15)]).toBe(2);
    paintRainBrush(f, GRID, 20, 15, 5, 0);
    paintRainBrush(f, GRID, 20, 15, 5, Number.NaN);
    expect(f[idx(20, 15)]).toBe(2);
    expect(() => paintRainBrush(new Float32Array(2), GRID, 1, 1, 1, 1)).toThrow(RangeError);
  });
});
