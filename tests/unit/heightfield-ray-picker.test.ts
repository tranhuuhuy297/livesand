import { describe, expect, it } from 'vitest';
import { gridToWorld, type GridSize, type Ray } from '../../src/core/types';
import { pickHeightfield, sampleHeightBilinear } from '../../src/input/heightfield-ray-picker';

const GRID: GridSize = { width: 128, height: 96 };
const field = (fn: (x: number, y: number) => number) => {
  const h = new Float32Array(GRID.width * GRID.height);
  for (let y = 0; y < GRID.height; y++) for (let x = 0; x < GRID.width; x++) h[y * GRID.width + x] = fn(x, y);
  return h;
};
const rayThrough = (from: [number, number, number], to: [number, number, number]): Ray => ({
  origin: from,
  dir: [to[0] - from[0], to[1] - from[1], to[2] - from[2]],
});

describe('sampleHeightBilinear', () => {
  it('interpolates between cells and clamps outside the grid', () => {
    const h = field((x, y) => x + 10 * y);
    expect(sampleHeightBilinear(h, GRID, 3.5, 2.25)).toBeCloseTo(3.5 + 22.5);
    expect(sampleHeightBilinear(h, GRID, -5, -5)).toBe(0);
    expect(sampleHeightBilinear(h, GRID, 500, 500)).toBe(127 + 950);
  });
});

describe('pickHeightfield', () => {
  it('hits flat terrain straight below the ray origin', () => {
    const h = field(() => 5);
    const hit = pickHeightfield(h, GRID, 1, { origin: [3.3, 100, -4.6], dir: [0, -1, 0] });
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeCloseTo(3.3 + 64, 4);
    expect(hit!.y).toBeCloseTo(-4.6 + 48, 4);
  });

  it('applies the vertical scale on oblique rays', () => {
    const h = field(() => 5);
    // Plane at y = 10; the unnormalised ray reaches it after 40 units of descent.
    const hit = pickHeightfield(h, GRID, 2, { origin: [0, 50, 0], dir: [1, -1, 0.5] });
    expect(hit!.x).toBeCloseTo(40 + 64, 2);
    expect(hit!.y).toBeCloseTo(20 + 48, 2);
  });

  it('finds the surface of a slope and it is the first crossing', () => {
    const h = field((x, y) => 0.25 * x + 0.1 * y);
    const vs = 1.5;
    const ray = rayThrough([-80, 60, -30], [20, 0, 10]);
    const hit = pickHeightfield(h, GRID, vs, ray)!;
    expect(hit).not.toBeNull();
    // The hit lies on the ray and on the surface.
    const [wx, , wz] = gridToWorld(GRID, hit.x, hit.y, 0, vs);
    const t = (wx - ray.origin[0]) / ray.dir[0];
    expect(wz).toBeCloseTo(ray.origin[2] + ray.dir[2] * t, 3);
    const rayY = ray.origin[1] + ray.dir[1] * t;
    expect(rayY).toBeCloseTo(sampleHeightBilinear(h, GRID, hit.x, hit.y) * vs, 2);
    for (let k = 0.05; k < 1; k += 0.05) {
      const tk = t * k;
      const x = ray.origin[0] + ray.dir[0] * tk + 64;
      const y = ray.origin[2] + ray.dir[2] * tk + 48;
      if (x >= 0 && x <= 127 && y >= 0 && y <= 95) {
        expect(ray.origin[1] + ray.dir[1] * tk).toBeGreaterThan(sampleHeightBilinear(h, GRID, x, y) * vs);
      }
    }
  });

  it('stops at a ridge that occludes the ground behind it', () => {
    const h = field((x) => (x >= 60 && x <= 64 ? 30 : 0));
    // Without the ridge this ray would land at grid x = 100.
    const ray = rayThrough(gridToWorld(GRID, 10, 40, 40, 1), gridToWorld(GRID, 100, 40, 0, 1));
    const hit = pickHeightfield(h, GRID, 1, ray)!;
    expect(hit.x).toBeGreaterThan(58);
    expect(hit.x).toBeLessThan(62);
    expect(hit.y).toBeCloseTo(40, 3);
  });

  it('returns the side wall when the ray enters the terrain block from the side', () => {
    const h = field(() => 10);
    const hit = pickHeightfield(h, GRID, 1, { origin: [-200, 5, 0], dir: [1, 0, 0] });
    expect(hit).toEqual({ x: 0, y: 48 });
  });

  it('returns null when the ray misses the grid', () => {
    const h = field((x) => x * 0.1);
    expect(pickHeightfield(h, GRID, 1, { origin: [0, 50, 0], dir: [0, 1, 0] })).toBeNull();
    expect(pickHeightfield(h, GRID, 1, { origin: [500, 50, 0], dir: [1, -0.1, 0] })).toBeNull();
    expect(pickHeightfield(h, GRID, 1, { origin: [-300, 100, 0], dir: [1, 0, 0] })).toBeNull();
    expect(pickHeightfield(h, GRID, 1, { origin: [0, 50, 0], dir: [0, 0, 0] })).toBeNull();
    expect(pickHeightfield(h, GRID, 1, { origin: [Number.NaN, 50, 0], dir: [0, -1, 0] })).toBeNull();
  });

  it('works from a typical orbit camera looking at the centre', () => {
    const h = field(() => 3);
    const eye: [number, number, number] = [0, 150, 180];
    const hit = pickHeightfield(h, GRID, 1, rayThrough(eye, [0, 3, 0]))!;
    expect(hit.x).toBeCloseTo(64, 3);
    expect(hit.y).toBeCloseTo(48, 3);
  });

  it('rejects mismatched heights', () => {
    expect(() => pickHeightfield(new Float32Array(5), GRID, 1, { origin: [0, 1, 0], dir: [0, -1, 0] })).toThrow(RangeError);
  });
});

describe('pickHeightfield robustness', () => {
  it('terminates on vertical rays over non-finite heights and still hits shallow rays far away', () => {
    const bad = field(() => Number.NaN);
    expect(pickHeightfield(bad, GRID, 1, { origin: [0, 50, 0], dir: [0, -1, 0] })).toBeNull();
    const h = field((x) => (x > 120 ? 2 : 0));
    const hit = pickHeightfield(h, GRID, 1, rayThrough([-64, 2.5, 0], [60, 1.5, 0]));
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeGreaterThan(119);
  });
});
