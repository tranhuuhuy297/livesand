// Deterministic volcano scene for the renderer harness: a cone with a lava lake, a flow down its flank into a lake, basalt fields.
import { gridToWorld, type GridSize } from '../../src/core/types';
import { DEFAULT_RENDER_STYLE } from '../../src/render/shading-common-wgsl';
import type { HarnessScene } from './renderers-harness-scene';
import { projectToScreen, type Probe } from './renderers-harness-pixels';

export interface LavaHarnessScene extends HarnessScene {
  lava: Float32Array;
  rock: Float32Array;
  /** Named grid points (x, y) for pixel probes: molten lava, basalt, steam off the lava front, and the lake. */
  points: Record<string, [number, number]>;
}

const VENT = { x: 84, y: 70 };
const LAKE = { x: 188, y: 138, level: 10.5 };
const CRATER_LAVA_LEVEL = 29.4;
// Lava channel from the crater breach down the south-east flank into the lake.
const FLOW: Array<[number, number]> = [[88, 75], [97, 86], [108, 97], [121, 106], [135, 114], [149, 122], [161, 128]];
// An older, cooled flow down the south-west flank.
const OLD_FLOW: Array<[number, number]> = [[78, 80], [72, 96], [64, 112], [52, 126], [44, 140]];

function gauss(x: number, y: number, cx: number, cy: number, sx: number, sy: number): number {
  const dx = (x - cx) / sx;
  const dy = (y - cy) / sy;
  return Math.exp(-(dx * dx + dy * dy));
}

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function hash(ix: number, iy: number): number {
  const s = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const ux = (x - ix) ** 2 * (3 - 2 * (x - ix));
  const uy = (y - iy) ** 2 * (3 - 2 * (y - iy));
  const a = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * ux;
  const b = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * ux;
  return a + (b - a) * uy - 0.5;
}

/** Distance to a polyline and the arc position 0..1 of the closest point. */
function polylineQuery(path: Array<[number, number]>, x: number, y: number): { dist: number; s: number } {
  const lengths = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], p[1] - path[i][1]));
  const total = lengths.reduce((a, b) => a + b, 0);
  let best = { dist: Infinity, s: 0 };
  let travelled = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i];
    const tx = (path[i + 1][0] - ax) / lengths[i];
    const ty = (path[i + 1][1] - ay) / lengths[i];
    const t = Math.min(lengths[i], Math.max(0, (x - ax) * tx + (y - ay) * ty));
    const dist = Math.hypot(ax + tx * t - x, ay + ty * t - y);
    if (dist < best.dist) best = { dist, s: (travelled + t) / total };
    travelled += lengths[i];
  }
  return best;
}

function craterRadius(x: number, y: number): number {
  return Math.hypot(x - VENT.x, (y - VENT.y) * 1.08);
}

function groundHeight(x: number, y: number): number {
  let h = 13 + 1.8 * Math.sin(x * 0.024 + 0.4) * Math.cos(y * 0.031);
  h += 2.2 * (valueNoise(x * 0.05, y * 0.05) + 0.5 * valueNoise(x * 0.12, y * 0.12)) + 0.5 * valueNoise(x * 0.3, y * 0.3);
  h += 9 * gauss(x, y, 226, 40, 26, 18) + 6 * gauss(x, y, 30, 170, 30, 16);
  h -= 12 * gauss(x, y, LAKE.x, LAKE.y, 46, 32);
  // Concave stratovolcano cone with a summit crater, its rim breached towards the south-east flow.
  const r = craterRadius(x, y);
  h += 25 * Math.max(0, 1 - r / 78) ** 1.7;
  const breach = Math.max(0, ((x - VENT.x) * 0.66 + (y - VENT.y) * 0.75) / Math.max(r, 1e-3));
  h -= (9 - 5 * breach ** 6) * (1 - smoothstep(5, 13, r)) + 2.5 * breach ** 6 * (1 - smoothstep(10, 16, r));
  return h;
}

export function buildVolcanoScene(grid: GridSize): LavaHarnessScene {
  const cells = grid.width * grid.height;
  const terrain = new Float32Array(cells);
  const water = new Float32Array(cells);
  const lava = new Float32Array(cells);
  const rock = new Float32Array(cells);
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      let ground = groundHeight(x, y);
      const flow = polylineQuery(FLOW, x, y);
      const halfWidth = 3.2 + 4.5 * flow.s + 1.2 * valueNoise(x * 0.2, y * 0.2);
      // The active flow sits in a shallow channel between basalt levees and ends in a rock delta at the shore.
      if (flow.dist < halfWidth) ground -= 0.8 * (1 - (flow.dist / halfWidth) ** 2);
      // Near the summit the channel is a notch cut through the crater rim, falling away from the lava lake.
      const notch = CRATER_LAVA_LEVEL - 1.9 - 18 * flow.s + 0.5 * (flow.dist / halfWidth) ** 2;
      if (flow.dist < halfWidth + 3 && flow.s < 0.3) ground = Math.min(ground, notch + 3 * smoothstep(halfWidth, halfWidth + 3, flow.dist));
      // Levees line the channel between the crater and the shore; at the lake the front runs straight into the water.
      const levee = craterRadius(x, y) > 13 ? 1.6 * smoothstep(0.9, 0.75, flow.s) : 0;
      let r = levee * smoothstep(halfWidth + 3.5, halfWidth + 0.5, flow.dist) * smoothstep(halfWidth - 1.5, halfWidth + 0.5, flow.dist);
      // Basalt delta: the flow has built a causeway of cooled rock out to the lake surface.
      const delta = smoothstep(halfWidth + 1.5, halfWidth - 0.5, flow.dist) * smoothstep(0.5, 0.72, flow.s);
      r = Math.max(r, (LAKE.level + 0.15 - ground) * delta);
      const old = polylineQuery(OLD_FLOW, x, y);
      const oldWidth = 4 + 7 * old.s;
      r += (1.2 + 0.8 * valueNoise(x * 0.25, y * 0.25)) * smoothstep(oldWidth, oldWidth - 3, old.dist);
      // Rock field: an old basalt plain north-east of the cone with a ragged, noisy edge.
      const field = gauss(x, y, 158, 50, 30, 17) + 0.35 * valueNoise(x * 0.09, y * 0.09);
      r += (0.8 + 0.9 * (valueNoise(x * 0.3, y * 0.3) + 0.5)) * smoothstep(0.42, 0.55, field);
      let l = 0;
      if (flow.dist < halfWidth) l = (1.0 + 0.6 * (1 - flow.s)) * (1 - (flow.dist / halfWidth) ** 2) * smoothstep(1.03, 0.97, flow.s);
      // Lava lake: fills the crater to a flat level just below the breach.
      if (craterRadius(x, y) < 14) l = Math.max(l, CRATER_LAVA_LEVEL - ground);
      rock[i] = r;
      lava[i] = l;
      terrain[i] = ground + r + l;
      const lakeMask = gauss(x, y, LAKE.x, LAKE.y, 70, 50) > 0.4;
      if (lakeMask && l < 0.05) water[i] = Math.max(0, LAKE.level - terrain[i]);
    }
  }
  return {
    terrain,
    water,
    lava,
    rock,
    flux: new Float32Array(cells * 4),
    emission: new Float32Array(cells),
    villages: [{ x: 132, y: 156, radius: 9, state: 'safe', flood01: 0 }],
    points: { crater: [VENT.x, VENT.y], flow: [121, 106], flowLow: [135, 114], basalt: [58, 120], field: [158, 50], steam: [166, 124], lake: [200, 146] },
  };
}

/** Lava probes: 2D at the cell centres, 3D at the projected surface point, each averaged over a small window. */
export function volcanoProbes(
  scene: LavaHarnessScene,
  grid: GridSize,
  viewProj: Float32Array,
): { p2d: Record<string, Probe>; p3d: Record<string, Probe> } {
  const p2d: Record<string, Probe> = {};
  const p3d: Record<string, Probe> = {};
  for (const [name, [x, y]] of Object.entries(scene.points)) {
    p2d[name] = { u: (x + 0.5) / grid.width, v: (y + 0.5) / grid.height, radius: 3 };
    const h = scene.terrain[Math.round(y) * grid.width + Math.round(x)];
    const screen = projectToScreen(viewProj, gridToWorld(grid, x, y, h, DEFAULT_RENDER_STYLE.verticalScale));
    if (screen) p3d[name] = { ...screen, radius: 3 };
  }
  return { p2d, p3d };
}
