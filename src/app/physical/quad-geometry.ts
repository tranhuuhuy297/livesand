// Small quad helpers shared by the ROI editor, the projector keystone and calibration validation.
import { computeHomography } from '../../core/homography';
import type { Quad, Vec2 } from '../../core/types';

export function unitSquareQuad(): Quad {
  return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
}

export function rectQuad(width: number, height: number): Quad {
  return [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
}

export function scaleQuad(q: Quad, sx: number, sy: number): Quad {
  return [
    { x: q[0].x * sx, y: q[0].y * sy },
    { x: q[1].x * sx, y: q[1].y * sy },
    { x: q[2].x * sx, y: q[2].y * sy },
    { x: q[3].x * sx, y: q[3].y * sy },
  ];
}

export function copyQuad(q: Quad): Quad {
  return [{ ...q[0] }, { ...q[1] }, { ...q[2] }, { ...q[3] }];
}

export function quadsEqual(a: Quad, b: Quad, eps = 1e-9): boolean {
  return a.every((p, i) => Math.abs(p.x - b[i].x) <= eps && Math.abs(p.y - b[i].y) <= eps);
}

/** Strictly convex with a consistent winding: a bow-tie (corners out of order) maps the sandbox inside out. */
export function isConvexQuad(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (!Number.isFinite(cross) || cross === 0) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Usable as a homography target: convex, finite and not degenerate. */
export function isUsableQuad(q: Quad): boolean {
  if (!isConvexQuad(q)) return false;
  try {
    computeHomography(unitSquareQuad(), q);
    return true;
  } catch {
    return false;
  }
}

/** Parses a JSON value into a Quad of finite points, or null. */
export function readQuad(value: unknown): Quad | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const pts: Vec2[] = [];
  for (const p of value as unknown[]) {
    if (!p || typeof p !== 'object') return null;
    const { x, y } = p as { x?: unknown; y?: unknown };
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    pts.push({ x, y });
  }
  return [pts[0], pts[1], pts[2], pts[3]];
}
