// Mount Ember: a volcanic cone whose summit crater is breached to the south, so overflowing lava runs down a deep gully
// into the village on the lower flank. Near the top, an old lava channel branches east to the sea behind a low sill:
// wall off the gully below the fork (or dig through the sill) and the lava turns east. Heights are fractions of relief.
import type { TerrainLayout } from './terrain-layouts';
import { lerp, smoothstep, type LayoutPoint } from './terrain-shaping-primitives';

export const VOLCANO_FEATURES = {
  crater: { u: 0.3, v: 0.28 },
  breach: { u: 0.302, v: 0.345 },
  fork: { u: 0.308, v: 0.46 },
  village: { u: 0.32, v: 0.74 },
  seaChannel: { u: 0.46, v: 0.48 },
  shore: { u: 0.63, v: 0.49 },
} satisfies Record<string, LayoutPoint>;

const V = VOLCANO_FEATURES;
// (height - 1) / (width - 1) of the 256x192 reference grid; keeps the cone round without the generator's aspect.
const CONE_ASPECT = 0.75;
const CONE_PEAK = 0.9;
const CONE_RADIUS = 0.46;
const CRATER_RADIUS = 0.045;
const RIM_LIP = 0.12;
const PLAIN = 0.06;
const SHORE_U = 0.64;

function coneRadius(u: number, v: number): number {
  return Math.hypot(u - V.crater.u, (v - V.crater.v) * CONE_ASPECT);
}

/** Cone profile plus a raised crater lip, as a fraction of relief at distance r (grid-width units) from the crater. */
export function volcanoCone(r: number): number {
  const lip = RIM_LIP * Math.exp(-(((r - CRATER_RADIUS) / 0.02) ** 2));
  return CONE_PEAK * Math.max(0, 1 - r / CONE_RADIUS) ** 1.4 + lip;
}

/** Cone on a coastal plain; the land dips under the sea along the east shore and tilts gently toward it. */
function volcanoBase(u: number, v: number): number {
  const land = PLAIN + volcanoCone(coneRadius(u, v)) + 0.05 * (0.5 - u);
  return lerp(land, 0, smoothstep(SHORE_U - 0.06, SHORE_U + 0.04, u));
}

/** Ground height at a layout point before noise and carving, for placing beds relative to the slope. */
export function volcanoSurface(p: LayoutPoint): number {
  return volcanoBase(p.u, p.v);
}

const below = (p: LayoutPoint, depth: number): number => volcanoSurface(p) - depth;
const rimHeight = volcanoSurface({ u: V.crater.u + CRATER_RADIUS, v: V.crater.v });
const craterFloor = rimHeight - 0.12;
// The breach lip sits above the crater floor, so the crater fills into a lava lake before it spills south.
const breachBed = craterFloor + 0.04;
const GULLY_DEPTH = 0.12;
const SILL_HEIGHT = 0.06;
const forkBed = below(V.fork, GULLY_DEPTH);
const midGully = { u: 0.314, v: 0.6 };
const gullyEnd = { u: 0.325, v: 1 };

export const volcanoLayout: TerrainLayout = {
  base: volcanoBase,
  // Gentle texture only: big bumps on the flanks would steer the lava more than the player's walls do.
  noiseAmplitude: (h) => 0.006 + 0.01 * smoothstep(0.2, 0.7, h),
  ops: [
    { kind: 'bowl', center: V.crater, radius: CRATER_RADIUS, floor: craterFloor, rim: rimHeight - craterFloor },
    {
      kind: 'channel',
      path: [V.crater, V.breach, V.fork, midGully, V.village, gullyEnd],
      bed: [breachBed, breachBed - 0.01, forkBed, below(midGully, GULLY_DEPTH), below(V.village, 0.05), below(gullyEnd, 0.02)],
      halfWidth: 0.024,
      bank: 0.1,
    },
    // The old channel east: its head is a sill above the gully bed, so idle lava stays in the gully.
    {
      kind: 'channel',
      path: [{ u: V.fork.u + 0.04, v: V.fork.v }, V.seaChannel, V.shore, { u: 0.75, v: 0.5 }],
      bed: [forkBed + SILL_HEIGHT, below(V.seaChannel, 0.05), 0.01, 0],
      halfWidth: 0.026,
      bank: 0.07,
    },
  ],
};
