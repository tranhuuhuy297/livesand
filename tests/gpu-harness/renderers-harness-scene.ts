// Deterministic demo scene for the renderer harness: hills, a river into a lake, rain, and three villages.
import type { GridSize, VillageMarker } from '../../src/core/types';

export interface HarnessScene {
  terrain: Float32Array;
  water: Float32Array;
  flux: Float32Array; // vec4 per cell: left, right, north, south outflow
  emission: Float32Array;
  villages: VillageMarker[];
}

const LAKE = { x: 176, y: 134, rx: 62, ry: 46, level: 10.5 };
const RIVER: Array<[number, number]> = [
  [92, 88], [104, 100], [112, 116], [126, 122], [140, 124], [152, 128],
];

function gauss(x: number, y: number, cx: number, cy: number, sx: number, sy: number): number {
  const dx = (x - cx) / sx;
  const dy = (y - cy) / sy;
  return Math.exp(-(dx * dx + dy * dy));
}

function hash(ix: number, iy: number): number {
  const s = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * ux;
  const b = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * ux;
  return a + (b - a) * uy - 0.5;
}

function fbm(x: number, y: number): number {
  return valueNoise(x, y) + 0.5 * valueNoise(x * 2.1, y * 2.1) + 0.25 * valueNoise(x * 4.3, y * 4.3);
}

/** Closest point on the river polyline: distance, arc position 0..1 and unit tangent. */
function riverQuery(x: number, y: number): { dist: number; s: number; tx: number; ty: number } {
  let best = { dist: Infinity, s: 0, tx: 1, ty: 0 };
  let travelled = 0;
  const lengths = RIVER.slice(1).map((p, i) => Math.hypot(p[0] - RIVER[i][0], p[1] - RIVER[i][1]));
  const total = lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [ax, ay] = RIVER[i];
    const [bx, by] = RIVER[i + 1];
    const len = lengths[i];
    const tx = (bx - ax) / len;
    const ty = (by - ay) / len;
    const t = Math.min(len, Math.max(0, (x - ax) * tx + (y - ay) * ty));
    const dist = Math.hypot(ax + tx * t - x, ay + ty * t - y);
    if (dist < best.dist) best = { dist, s: (travelled + t) / total, tx, ty };
    travelled += len;
  }
  return best;
}

function baseTerrain(x: number, y: number): number {
  let h = 14 + 2.5 * Math.sin(x * 0.021 + 1) * Math.cos(y * 0.026);
  h += 23 * gauss(x, y, 60, 56, 36, 30);
  h += 11 * gauss(x, y, 116, 34, 20, 16);
  h += 13 * gauss(x, y, 205, 42, 40, 13) + 7 * gauss(x, y, 236, 78, 16, 22);
  h += 8 * gauss(x, y, 226, 170, 18, 15);
  h -= 13 * gauss(x, y, LAKE.x, LAKE.y, 44, 32);
  h += 2.2 * fbm(x * 0.045, y * 0.045) + 0.6 * fbm(x * 0.16, y * 0.16);
  return h;
}

export function buildHarnessScene(grid: GridSize): HarnessScene {
  const cells = grid.width * grid.height;
  const terrain = new Float32Array(cells);
  const water = new Float32Array(cells);
  const flux = new Float32Array(cells * 4);
  const emission = new Float32Array(cells);
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      let h = baseTerrain(x, y);
      const river = riverQuery(x, y);
      const bed = 19 - 9.5 * river.s;
      const halfWidth = 4.5;
      if (river.dist < halfWidth * 2.2) {
        const carved = bed + (river.dist / halfWidth) ** 2 * 3.2;
        const blend = Math.min(1, Math.max(0, (halfWidth * 2.2 - river.dist) / (halfWidth * 0.8)));
        h = Math.min(h, h + (carved - h) * blend);
      }
      terrain[i] = h;
      const lx = (x - LAKE.x) / LAKE.rx;
      const ly = (y - LAKE.y) / LAKE.ry;
      if (lx * lx + ly * ly < 1) water[i] = Math.max(0, LAKE.level - h);
      if (river.dist < halfWidth && river.s < 0.98) {
        const depth = Math.max(0, bed + 1.1 - h);
        if (depth > water[i]) {
          water[i] = depth;
          const speed = 3.5 * (1 - river.dist / halfWidth) + 0.6;
          const qx = river.tx * depth * speed;
          const qy = river.ty * depth * speed;
          flux.set([Math.max(-qx, 0), Math.max(qx, 0), Math.max(-qy, 0), Math.max(qy, 0)], i * 4);
        }
      }
      const rain = gauss(x, y, 208, 98, 30, 24);
      emission[i] = rain > 0.2 ? 0.45 * rain : 0;
    }
  }
  const villages: VillageMarker[] = [
    { x: 66, y: 142, radius: 11, state: 'safe', flood01: 0 },
    { x: 124, y: 146, radius: 10, state: 'flooding', flood01: 0.55 },
    { x: 192, y: 146, radius: 10, state: 'lost', flood01: 1 },
  ];
  return { terrain, water, flux, emission, villages };
}
