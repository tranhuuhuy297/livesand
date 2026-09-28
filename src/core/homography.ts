// Planar homographies (3x3, row-major) for depth-ROI resampling and projector corner-pin keystone.
import type { Mat3, Quad, Vec2 } from './types';

// Relative tolerance: three corners closer to collinear than this are treated as degenerate.
const COLLINEAR_EPS = 1e-9;
// Pivot tolerance for the 8x8 solve; inputs are normalized so entries are O(1).
const PIVOT_EPS = 1e-12;
// Relative determinant tolerance for invertMat3 (scaled by max|entry|^3).
const SINGULAR_EPS = 1e-14;

function assertQuad(q: Quad, label: string): void {
  if (!Array.isArray(q) || q.length !== 4) throw new Error(`${label} quad must have exactly 4 corners`);
  for (const p of q) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error(`${label} quad has a non-finite corner`);
  }
  let scale = 0;
  for (const a of q) for (const b of q) scale = Math.max(scale, Math.hypot(a.x - b.x, a.y - b.y));
  if (scale === 0) throw new Error(`${label} quad is degenerate (all corners coincide)`);
  // Any 3 of 4 corners collinear means no projective map exists (or it is not unique).
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) <= COLLINEAR_EPS * scale * scale) {
      throw new Error(`${label} quad is degenerate (three corners are collinear)`);
    }
  }
}

function multiplyMat3(a: Mat3, b: Mat3): Mat3 {
  const out = new Float64Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

/** Similarity moving the centroid to 0 and mean distance to sqrt(2) (Hartley) — keeps the solve well conditioned. */
function normalizer(q: Quad): Mat3 {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  let mean = 0;
  for (const p of q) mean += Math.hypot(p.x - cx, p.y - cy) / 4;
  const s = Math.SQRT2 / mean;
  return Float64Array.of(s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1);
}

/** Gaussian elimination with partial pivoting on an 8x9 augmented matrix (modified in place). */
function solve8(m: Float64Array): Float64Array {
  const n = 8, w = 9;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r * w + col]) > Math.abs(m[pivot * w + col])) pivot = r;
    }
    if (!(Math.abs(m[pivot * w + col]) > PIVOT_EPS)) throw new Error('Homography is degenerate (singular system)');
    if (pivot !== col) {
      for (let c = 0; c < w; c++) {
        const t = m[col * w + c];
        m[col * w + c] = m[pivot * w + c];
        m[pivot * w + c] = t;
      }
    }
    for (let r = col + 1; r < n; r++) {
      const f = m[r * w + col] / m[col * w + col];
      if (f === 0) continue;
      for (let c = col; c < w; c++) m[r * w + c] -= f * m[col * w + c];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let sum = m[r * w + n];
    for (let c = r + 1; c < n; c++) sum -= m[r * w + c] * x[c];
    x[r] = sum / m[r * w + r];
  }
  return x;
}

/** Maps src[i] -> dst[i] (i = 0..3); result normalized so h[8] = 1. Throws on degenerate quads. */
export function computeHomography(src: Quad, dst: Quad): Mat3 {
  assertQuad(src, 'Source');
  assertQuad(dst, 'Destination');
  const ts = normalizer(src);
  const td = normalizer(dst);
  const a = new Float64Array(72);
  for (let i = 0; i < 4; i++) {
    const s = applyHomography(ts, src[i]);
    const d = applyHomography(td, dst[i]);
    a.set([s.x, s.y, 1, 0, 0, 0, -d.x * s.x, -d.x * s.y, d.x], (2 * i) * 9);
    a.set([0, 0, 0, s.x, s.y, 1, -d.y * s.x, -d.y * s.y, d.y], (2 * i + 1) * 9);
  }
  const h = solve8(a);
  const hn = Float64Array.of(h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1);
  const out = multiplyMat3(multiplyMat3(invertMat3(td), hn), ts);
  let maxAbs = 0;
  for (const v of out) maxAbs = Math.max(maxAbs, Math.abs(v));
  // h[8] ~ 0 only when the source origin maps to infinity; fall back to max-norm scaling then.
  const scale = Math.abs(out[8]) > 1e-12 * maxAbs ? out[8] : maxAbs;
  for (let i = 0; i < 9; i++) out[i] /= scale;
  if (!out.every(Number.isFinite)) throw new Error('Homography is degenerate (non-finite result)');
  return out;
}

export function applyHomography(h: Mat3, p: Vec2): Vec2 {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

/** Inverse of a 3x3 row-major matrix via the adjugate; throws if (numerically) singular. */
export function invertMat3(m: Mat3): Mat3 {
  if (m.length !== 9) throw new Error('invertMat3 expects a 3x3 matrix (length 9)');
  const [a, b, c, d, e, f, g, h, i] = m;
  const c00 = e * i - f * h, c01 = -(d * i - f * g), c02 = d * h - e * g;
  const det = a * c00 + b * c01 + c * c02;
  let maxAbs = 0;
  for (const v of m) maxAbs = Math.max(maxAbs, Math.abs(v));
  if (!Number.isFinite(det) || Math.abs(det) <= SINGULAR_EPS * maxAbs * maxAbs * maxAbs) {
    throw new Error('Matrix is singular and cannot be inverted');
  }
  const k = 1 / det;
  return Float64Array.of(
    c00 * k, -(b * i - c * h) * k, (b * f - c * e) * k,
    c01 * k, (a * i - c * g) * k, -(a * f - c * d) * k,
    c02 * k, -(a * h - b * g) * k, (a * e - b * d) * k,
  );
}

// CSS numbers without exponent notation for maximum parser compatibility.
function cssNumber(v: number): string {
  if (Math.abs(v) < 1e-15) return '0';
  const s = String(v);
  return s.includes('e') ? v.toFixed(20) : s;
}

/**
 * CSS `matrix3d(...)` mapping an element's rect (0,0)-(width,height) onto `quad` (px).
 * Use with `transform-origin: 0 0`.
 */
export function cornerPinCssTransform(width: number, height: number, quad: Quad): string {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new RangeError('cornerPinCssTransform needs a positive finite width and height');
  }
  const rect: Quad = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
  const h = computeHomography(rect, quad);
  // Embed the 2D homography in a 4x4 (z passes through), listed column-major as CSS expects.
  const m = [h[0], h[3], 0, h[6], h[1], h[4], 0, h[7], 0, 0, 1, 0, h[2], h[5], 0, h[8]];
  return `matrix3d(${m.map(cssNumber).join(', ')})`;
}
