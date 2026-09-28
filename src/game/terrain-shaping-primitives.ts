// Analytic carving primitives in normalised layout space (u,v in 0..1; heights as a fraction of relief).
// Distances are measured in grid-width units with the grid aspect applied, so shapes stay round on any grid.

export interface LayoutPoint {
  u: number;
  v: number;
}

/** Carves a river bed (min): bed height per path vertex, parabolic banks rising `bank` at `halfWidth`. */
export interface ChannelOp {
  kind: 'channel';
  path: LayoutPoint[];
  bed: number[];
  halfWidth: number;
  bank: number;
}

/** Carves a round hollow (min): `floor` at the centre, rising `rim` at `radius`. */
export interface BowlOp {
  kind: 'bowl';
  center: LayoutPoint;
  radius: number;
  floor: number;
  rim: number;
}

/** Raises a ridge / sill / levee (max): crest height per vertex, falling `drop` at `halfWidth`. */
export interface RidgeOp {
  kind: 'ridge';
  path: LayoutPoint[];
  crest: number[];
  halfWidth: number;
  drop: number;
}

export type TerrainOp = ChannelOp | BowlOp | RidgeOp;

/** Hermite smoothstep that also works for reversed edges (e0 > e1). */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Evaluates a polyline profile at (u,v): for every segment, value = height(t) + sign * k * (d / halfWidth)^2,
 * combined with min (sign +1, carving) or max (sign -1, raising).
 */
function polylineProfile(
  u: number, v: number, aspect: number, path: LayoutPoint[], heights: number[],
  halfWidth: number, k: number, sign: 1 | -1,
): number {
  let best = sign > 0 ? Infinity : -Infinity;
  const py = v * aspect;
  for (let i = 0; i < path.length - 1; i++) {
    const ax = path[i].u;
    const ay = path[i].v * aspect;
    const bx = path[i + 1].u;
    const by = path[i + 1].v * aspect;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((u - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const ex = u - (ax + dx * t);
    const ey = py - (ay + dy * t);
    const dn = Math.sqrt(ex * ex + ey * ey) / halfWidth;
    const value = lerp(heights[i], heights[i + 1], t) + sign * k * dn * dn;
    best = sign > 0 ? Math.min(best, value) : Math.max(best, value);
  }
  return best;
}

/** Applies one op to a normalised height at (u,v); `aspect` = (gridHeight - 1) / (gridWidth - 1). */
export function applyTerrainOp(h: number, u: number, v: number, aspect: number, op: TerrainOp): number {
  switch (op.kind) {
    case 'channel':
      return Math.min(h, polylineProfile(u, v, aspect, op.path, op.bed, op.halfWidth, op.bank, 1));
    case 'ridge':
      return Math.max(h, polylineProfile(u, v, aspect, op.path, op.crest, op.halfWidth, op.drop, -1));
    case 'bowl': {
      const dx = u - op.center.u;
      const dy = (v - op.center.v) * aspect;
      const dn2 = (dx * dx + dy * dy) / (op.radius * op.radius);
      return Math.min(h, op.floor + op.rim * dn2);
    }
  }
}
