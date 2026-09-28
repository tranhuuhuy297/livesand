// CPU-built geometry for the 3D view: heightfield index lists (surface + box-wall skirts) and a unit house mesh.
import type { GridSize } from '../core/types';

/**
 * Surface triangles over the vertex grid (id = y * width + x) followed by skirt quads along the four edges.
 * Skirt quads join a top vertex (id + skirtTopOffset) to a floor vertex (id + cells); every skirt triangle starts
 * with a floor vertex so a flat-interpolated "skirt" varying is 1 across the whole wall.
 */
export function buildHeightfieldIndices(grid: GridSize, skirtTopOffset: number): { indices: Uint32Array; surfaceCount: number } {
  const { width: w, height: h } = grid;
  if (w < 2 || h < 2) throw new Error(`Heightfield needs at least 2x2 cells, got ${w}x${h}`);
  const cells = w * h;
  const surfaceCount = (w - 1) * (h - 1) * 6;
  const skirtCount = (2 * (w - 1) + 2 * (h - 1)) * 6;
  const indices = new Uint32Array(surfaceCount + skirtCount);
  let k = 0;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const a = y * w + x;
      const b = a + 1;
      const c = a + w;
      const d = c + 1;
      indices.set([a, c, b, b, c, d], k);
      k += 6;
    }
  }
  const edge = (e0: number, e1: number): void => {
    const t0 = e0 + skirtTopOffset;
    const t1 = e1 + skirtTopOffset;
    const b0 = e0 + cells;
    const b1 = e1 + cells;
    indices.set([b0, t0, t1, b1, b0, t1], k);
    k += 6;
  };
  for (let x = 0; x < w - 1; x++) {
    edge(x, x + 1);
    edge((h - 1) * w + x + 1, (h - 1) * w + x);
  }
  for (let y = 0; y < h - 1; y++) {
    edge((y + 1) * w, y * w);
    edge(y * w + w - 1, (y + 1) * w + w - 1);
  }
  return { indices, surfaceCount };
}

/** Floats per house vertex: position xyz, normal xyz, part (0 wall, 1 roof). */
export const HOUSE_VERTEX_FLOATS = 7;

type V3 = [number, number, number];

function pushQuad(out: number[], a: V3, b: V3, c: V3, d: V3, n: V3, part: number): void {
  for (const p of [a, b, c, a, c, d]) out.push(p[0], p[1], p[2], n[0], n[1], n[2], part);
}

function normalized(v: V3): V3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * Unit house: ridge along local x, footprint x in [-0.5, 0.5], z in [-0.34, 0.34] (matches the 2D rooftop box).
 * Walls start below 0 so houses on slopes never float.
 */
export function buildHouseMesh(): Float32Array {
  const out: number[] = [];
  const x0 = -0.5, x1 = 0.5, z0 = -0.34, z1 = 0.34;
  const yb = -0.6, ye = 0.5, yr = 0.95;
  const ox = 0.56, oz = 0.42, yo = 0.44; // eaves overhang
  pushQuad(out, [x0, yb, z1], [x1, yb, z1], [x1, ye, z1], [x0, ye, z1], [0, 0, 1], 0);
  pushQuad(out, [x1, yb, z0], [x0, yb, z0], [x0, ye, z0], [x1, ye, z0], [0, 0, -1], 0);
  pushQuad(out, [x1, yb, z1], [x1, yb, z0], [x1, ye, z0], [x1, ye, z1], [1, 0, 0], 0);
  pushQuad(out, [x0, yb, z0], [x0, yb, z1], [x0, ye, z1], [x0, ye, z0], [-1, 0, 0], 0);
  // Gable triangles closing the roof ends.
  for (const [x, nx] of [[x1, 1], [x0, -1]] as const) {
    out.push(x, ye, z0, nx, 0, 0, 0, x, ye, z1, nx, 0, 0, 0, x, yr, 0, nx, 0, 0, 0);
  }
  const southN = normalized([0, oz, yr - yo]);
  const northN = normalized([0, oz, -(yr - yo)]);
  pushQuad(out, [-ox, yo, oz], [ox, yo, oz], [ox, yr, 0], [-ox, yr, 0], southN, 1);
  pushQuad(out, [ox, yo, -oz], [-ox, yo, -oz], [-ox, yr, 0], [ox, yr, 0], northN, 1);
  return new Float32Array(out);
}
