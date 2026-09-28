// Hand-designed landforms per terrain kind. Feature points are exported so levels place springs and villages
// exactly where the carved hydrology sends the water. Heights are fractions of relief; u,v in 0..1 (north = v 0).
import type { TerrainKind } from './terrain-generators';
import { lerp, smoothstep, type LayoutPoint, type TerrainOp } from './terrain-shaping-primitives';

export interface TerrainLayout {
  /** Smooth landform before noise and carving. */
  base(u: number, v: number): number;
  /** fBm amplitude; low ground stays smooth so valley floors and villages don't grow random puddles. */
  noiseAmplitude(baseHeight: number): number;
  ops: TerrainOp[];
}

// Sea level is exactly 0 (the lowest sculptable height) so any trench dug to an open edge actually drains.
const roughHighlands = (h: number): number => 0.012 * smoothstep(0, 0.08, h) + 0.07 * smoothstep(0.22, 0.6, h);

// ---------------------------------------------------------------- river-valley
// Northern hills feed one river running south into a lake on the floodplain; the village sits on its shore.
// A thin coastal bank separates the valley from the sea (east): cut through it from the lake or at the bend.
export const RIVER_VALLEY_FEATURES = {
  spring: { u: 0.36, v: 0.07 },
  bend: { u: 0.52, v: 0.34 },
  lake: { u: 0.5, v: 0.76 },
  village: { u: 0.43, v: 0.73 },
} satisfies Record<string, LayoutPoint>;

const RV_AXIS_U = 0.42;
const RV_BANK_U = 0.6;
const RV_BANK_HEIGHT = 0.07;

function riverValleyAxis(v: number): number {
  return 0.14 + 0.48 * (1 - smoothstep(0, 0.68, v)) + 0.26 * smoothstep(0.84, 1, v);
}

function riverValleyBase(u: number, v: number): number {
  const axis = riverValleyAxis(v);
  if (u < RV_AXIS_U) return axis + 0.32 * ((RV_AXIS_U - u) / RV_AXIS_U) ** 2;
  if (u < RV_BANK_U) return axis + RV_BANK_HEIGHT * ((u - RV_AXIS_U) / (RV_BANK_U - RV_AXIS_U)) ** 2;
  return lerp(axis + RV_BANK_HEIGHT, 0, smoothstep(RV_BANK_U, 0.8, u));
}

const RV = RIVER_VALLEY_FEATURES;
const riverValley: TerrainLayout = {
  base: riverValleyBase,
  noiseAmplitude: roughHighlands,
  ops: [
    {
      kind: 'channel',
      path: [{ u: 0.36, v: 0 }, RV.spring, { u: 0.4, v: 0.2 }, RV.bend, { u: 0.48, v: 0.5 }, { u: 0.53, v: 0.64 }, RV.lake],
      bed: [0.6, 0.57, 0.46, 0.33, 0.2, 0.14, 0.1],
      halfWidth: 0.025,
      bank: 0.05,
    },
    // The village shore rises gently from the lake floor, so it floods only once the lake itself rises.
    { kind: 'bowl', center: RV.lake, radius: 0.1, floor: 0.1, rim: 0.07 },
  ],
};

// ---------------------------------------------------------------- twin-valleys
// Two valleys split by a central ridge drain south to the sea. At each fork the main arm must climb a low sill,
// so the river turns into a side arm that fills the hollow below a town. Levee the side arm (or dig the sill).
export const TWIN_VALLEYS_FEATURES = {
  westSpring: { u: 0.25, v: 0.06 },
  westFork: { u: 0.25, v: 0.4 },
  westHollow: { u: 0.13, v: 0.42 },
  westTown: { u: 0.08, v: 0.49 },
  eastSpring: { u: 0.75, v: 0.06 },
  eastFork: { u: 0.75, v: 0.56 },
  eastHollow: { u: 0.87, v: 0.58 },
  eastTown: { u: 0.92, v: 0.65 },
} satisfies Record<string, LayoutPoint>;

function twinValleysBase(u: number, v: number): number {
  const hills = 0.34 * (1 - smoothstep(0, 0.55, v));
  const tilt = 0.28 * (1 - v);
  const valleyDist = Math.min(Math.abs(u - 0.25), Math.abs(u - 0.75)) / 0.25;
  return hills + tilt + 0.26 * valleyDist * valleyDist;
}

/** River + sill + side arm + hollow for one valley; `forkBed` is the river bed height at the fork. */
function forkedRiver(spring: LayoutPoint, fork: LayoutPoint, hollow: LayoutPoint, forkBed: number): TerrainOp[] {
  const down = (dv: number): LayoutPoint => ({ u: fork.u, v: fork.v + dv });
  return [
    {
      kind: 'channel',
      path: [{ u: spring.u, v: 0 }, spring, fork, down(0.04), { u: fork.u, v: 1 }],
      bed: [0.58, 0.55, forkBed, forkBed - 0.005, 0],
      halfWidth: 0.025,
      bank: 0.05,
    },
    { kind: 'ridge', path: [{ u: fork.u - 0.04, v: fork.v + 0.035 }, { u: fork.u + 0.04, v: fork.v + 0.035 }], crest: [forkBed + 0.03, forkBed + 0.03], halfWidth: 0.012, drop: 0.05 },
    { kind: 'channel', path: [fork, hollow], bed: [forkBed, forkBed - 0.06], halfWidth: 0.02, bank: 0.05 },
    { kind: 'bowl', center: hollow, radius: 0.08, floor: forkBed - 0.067, rim: 0.12 },
  ];
}

const TV = TWIN_VALLEYS_FEATURES;
const twinValleys: TerrainLayout = {
  base: twinValleysBase,
  noiseAmplitude: roughHighlands,
  ops: [
    ...forkedRiver(TV.westSpring, TV.westFork, TV.westHollow, twinValleysBase(TV.westFork.u, TV.westFork.v) - 0.05),
    ...forkedRiver(TV.eastSpring, TV.eastFork, TV.eastHollow, twinValleysBase(TV.eastFork.u, TV.eastFork.v) - 0.05),
  ],
};

// ---------------------------------------------------------------- mountain-basin
// Mountains drain into a central lake; a canyon to the southern sea starts at a rock sill, so storm runoff
// raises the lake over the shore villages unless the canyon is dug out and the villages are raised or leveed.
export const MOUNTAIN_BASIN_FEATURES = {
  lake: { u: 0.5, v: 0.48 },
  gorgeHead: { u: 0.5, v: 0.6 },
  lowVillage: { u: 0.43, v: 0.57 },
  westVillage: { u: 0.39, v: 0.43 },
  eastVillage: { u: 0.62, v: 0.45 },
  westSpring: { u: 0.1, v: 0.28 },
  eastSpring: { u: 0.9, v: 0.2 },
} satisfies Record<string, LayoutPoint>;

const MB_SILL = 0.13;

function mountainBasinBase(u: number, v: number): number {
  const dx = (u - MOUNTAIN_BASIN_FEATURES.lake.u) / 0.5;
  const dy = (v - MOUNTAIN_BASIN_FEATURES.lake.v) / 0.5;
  return 0.03 + 0.75 * Math.sqrt(dx * dx + dy * dy) ** 1.6;
}

const MB = MOUNTAIN_BASIN_FEATURES;
const mountainBasin: TerrainLayout = {
  base: mountainBasinBase,
  noiseAmplitude: roughHighlands,
  ops: [
    {
      kind: 'channel',
      path: [{ u: 0.5, v: 0.55 }, MB.gorgeHead, { u: 0.53, v: 0.8 }, { u: 0.5, v: 1 }],
      bed: [MB_SILL, MB_SILL - 0.005, 0.06, 0],
      halfWidth: 0.018,
      bank: 0.12,
    },
    { kind: 'channel', path: [MB.westSpring, { u: 0.3, v: 0.22 }, { u: 0.47, v: 0.4 }], bed: [0.5, 0.22, 0.05], halfWidth: 0.02, bank: 0.06 },
    { kind: 'channel', path: [MB.eastSpring, { u: 0.7, v: 0.2 }, { u: 0.53, v: 0.4 }], bed: [0.6, 0.24, 0.05], halfWidth: 0.02, bank: 0.06 },
  ],
};

const flat: TerrainLayout = {
  base: () => 0.3,
  noiseAmplitude: () => 0,
  ops: [],
};

export const TERRAIN_LAYOUTS = {
  'river-valley': riverValley,
  'twin-valleys': twinValleys,
  'mountain-basin': mountainBasin,
  flat,
} satisfies Record<TerrainKind, TerrainLayout>;
