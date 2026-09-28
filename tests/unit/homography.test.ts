import { describe, expect, it } from 'vitest';
import { applyHomography, computeHomography, cornerPinCssTransform, invertMat3 } from '../../src/core/homography';
import type { Mat3, Quad, Vec2 } from '../../src/core/types';

const unitSquare: Quad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
const perspectiveQuad: Quad = [{ x: 12, y: 7 }, { x: 230, y: 20 }, { x: 250, y: 185 }, { x: 3, y: 170 }];
const projectorQuad: Quad = [{ x: 83.5, y: 41 }, { x: 1850, y: 12 }, { x: 1901, y: 1060 }, { x: 40, y: 1003.25 }];

function expectPointClose(a: Vec2, b: Vec2, digits = 6): void {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
}

function mul(a: Mat3, b: Mat3): number[] {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    out.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
  }
  return out;
}

function parseMatrix3d(css: string): number[] {
  const m = /^matrix3d\(([^)]*)\)$/.exec(css);
  if (!m) throw new Error(`not a matrix3d: ${css}`);
  return m[1].split(',').map((s) => Number(s.trim()));
}

/** Applies a CSS column-major 4x4 to (x, y, 0, 1) with perspective divide. */
function applyCssMatrix(m: number[], p: Vec2): Vec2 {
  const v = [p.x, p.y, 0, 1];
  const out = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[r] += m[c * 4 + r] * v[c];
  return { x: out[0] / out[3], y: out[1] / out[3] };
}

describe('computeHomography', () => {
  it('maps every source corner onto its destination corner and normalizes h[8] = 1', () => {
    const h = computeHomography(unitSquare, perspectiveQuad);
    expect(h).toBeInstanceOf(Float64Array);
    expect(h.length).toBe(9);
    expect(h[8]).toBe(1);
    for (let i = 0; i < 4; i++) expectPointClose(applyHomography(h, unitSquare[i]), perspectiveQuad[i], 9);
  });

  it('is the identity when src equals dst', () => {
    const h = computeHomography(perspectiveQuad, perspectiveQuad);
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    h.forEach((v, i) => expect(v).toBeCloseTo(identity[i], 9));
  });

  it('round-trips interior points through the forward and inverse maps', () => {
    const h = computeHomography(projectorQuad, perspectiveQuad);
    const inv = invertMat3(h);
    const back = computeHomography(perspectiveQuad, projectorQuad);
    for (const p of [{ x: 100, y: 100 }, { x: 960, y: 540 }, { x: 1800, y: 900 }, { x: 55.25, y: 1000 }]) {
      const q = applyHomography(h, p);
      expectPointClose(applyHomography(inv, q), p, 7);
      expectPointClose(applyHomography(back, q), p, 7);
    }
  });

  it('matches a known affine map exactly (scale + translate)', () => {
    const dst: Quad = [{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 60 }, { x: 10, y: 60 }];
    const h = computeHomography(unitSquare, dst);
    const expected = [20, 0, 10, 0, 40, 20, 0, 0, 1];
    h.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 9));
  });

  it('throws on degenerate quads', () => {
    const collinear: Quad = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 0, y: 5 }];
    const repeated: Quad = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
    const point: Quad = [{ x: 3, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 3 }];
    const nan: Quad = [{ x: 0, y: 0 }, { x: NaN, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    expect(() => computeHomography(unitSquare, collinear)).toThrow(/degenerate/);
    expect(() => computeHomography(collinear, unitSquare)).toThrow(/degenerate/);
    expect(() => computeHomography(unitSquare, repeated)).toThrow(/degenerate/);
    expect(() => computeHomography(point, unitSquare)).toThrow(/degenerate/);
    expect(() => computeHomography(unitSquare, nan)).toThrow(/non-finite/);
  });
});

describe('invertMat3', () => {
  it('produces the matrix inverse', () => {
    const m = Float64Array.of(2, -1, 3, 0.5, 4, -2, 1e-3, 2e-3, 1);
    const prod = mul(m, invertMat3(m));
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(prod[i]).toBeCloseTo(v, 12));
  });

  it('throws on singular matrices', () => {
    expect(() => invertMat3(Float64Array.of(1, 2, 3, 2, 4, 6, 7, 8, 9))).toThrow(/singular/);
    expect(() => invertMat3(new Float64Array(9))).toThrow(/singular/);
    expect(() => invertMat3(new Float64Array(4))).toThrow();
  });
});

describe('cornerPinCssTransform', () => {
  it('returns a column-major matrix3d that maps the element rect corners onto the quad', () => {
    const css = cornerPinCssTransform(1920, 1080, projectorQuad);
    expect(css.startsWith('matrix3d(')).toBe(true);
    expect(css).not.toMatch(/e[-+]?\d/i);
    const m = parseMatrix3d(css);
    expect(m).toHaveLength(16);
    expect(m.every(Number.isFinite)).toBe(true);
    const rect: Vec2[] = [{ x: 0, y: 0 }, { x: 1920, y: 0 }, { x: 1920, y: 1080 }, { x: 0, y: 1080 }];
    rect.forEach((p, i) => expectPointClose(applyCssMatrix(m, p), projectorQuad[i], 5));
    // Interior points agree with the 2D homography too.
    const h = computeHomography(rect as Quad, projectorQuad);
    expectPointClose(applyCssMatrix(m, { x: 700, y: 300 }), applyHomography(h, { x: 700, y: 300 }), 5);
  });

  it('is the identity matrix when the quad equals the rect', () => {
    const quad: Quad = [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }, { x: 0, y: 600 }];
    const m = parseMatrix3d(cornerPinCssTransform(800, 600, quad));
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1].forEach((v, i) => expect(m[i]).toBeCloseTo(v, 9));
  });

  it('rejects bad sizes and degenerate quads', () => {
    expect(() => cornerPinCssTransform(0, 100, projectorQuad)).toThrow(RangeError);
    expect(() => cornerPinCssTransform(100, NaN, projectorQuad)).toThrow(RangeError);
    const flat: Quad = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 10 }];
    expect(() => cornerPinCssTransform(100, 100, flat)).toThrow(/degenerate/);
  });
});
