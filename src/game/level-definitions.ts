// Hand-tuned "save the village" levels. Positions come from the terrain layouts so the carved rivers always
// run into the villages: if the player does nothing, they flood.
import type { EdgeFlags } from '../core/types';
import { MOUNTAIN_BASIN_FEATURES as MB, RIVER_VALLEY_FEATURES as RV, TWIN_VALLEYS_FEATURES as TV } from './terrain-layouts';
import type { TerrainRecipe } from './terrain-generators';

/** u,v normalised 0..1 (north = v 0); radius as a fraction of grid width. */
export interface VillageSpec {
  u: number;
  v: number;
  radius: number;
  name: string;
}

/** u,v normalised 0..1; radius as a fraction of grid width; rate in world units/s per covered cell. */
export interface WaterSourceSpec {
  u: number;
  v: number;
  radius: number;
  rate: number;
}

/** Global rain (units/s) at time t (s); linearly interpolated between keyframes, held beyond the ends. */
export interface StormKeyframe {
  t: number;
  rain: number;
}

export interface LevelDefinition {
  id: string;
  name: string;
  tagline: string;
  recipe: TerrainRecipe;
  villages: VillageSpec[];
  sources: WaterSourceSpec[];
  openEdges: EdgeFlags;
  durationSec: number;
  storm: StormKeyframe[];
  floodDepthThreshold: number;
  floodSecondsToLose: number;
  /** Seconds of spring flow simulated at load, so rivers already run under the briefing card. */
  prefillSec?: number;
}

const edges = (open: Partial<EdgeFlags>): EdgeFlags => ({ north: false, east: false, south: false, west: false, ...open });

export const LEVELS: LevelDefinition[] = [
  {
    id: 'first-flood',
    name: 'First Flood',
    tagline: 'A spring in the hills feeds the lake beside Millbrook, and the lake is rising. Dig a channel east through the bank to the sea.',
    recipe: { kind: 'river-valley', seed: 1107 },
    villages: [{ ...RV.village, radius: 0.03, name: 'Millbrook' }],
    sources: [{ ...RV.spring, radius: 0.016, rate: 0.6 }],
    openEdges: edges({ east: true }),
    durationSec: 60,
    storm: [],
    floodDepthThreshold: 0.5,
    floodSecondsToLose: 20,
    prefillSec: 12,
  },
  {
    id: 'twin-towns',
    name: 'Twin Towns',
    tagline: 'At each fork the river spills into the hollow below a town. Build a levee across each side arm so both rivers run on to the sea.',
    recipe: { kind: 'twin-valleys', seed: 2203 },
    villages: [
      { ...TV.westTown, radius: 0.035, name: 'Westford' },
      { ...TV.eastTown, radius: 0.035, name: 'Eastholm' },
    ],
    sources: [
      { ...TV.westSpring, radius: 0.015, rate: 0.65 },
      { ...TV.eastSpring, radius: 0.015, rate: 0.65 },
    ],
    openEdges: edges({ south: true }),
    durationSec: 110,
    storm: [],
    floodDepthThreshold: 0.5,
    floodSecondsToLose: 15,
    prefillSec: 8,
  },
  {
    id: 'flash-flood',
    name: 'Flash Flood',
    tagline: 'A storm is breaking over the mountains and the lake will rise. Dig out the canyon to the sea and raise the villages above the flood.',
    recipe: { kind: 'mountain-basin', seed: 3301 },
    villages: [
      { ...MB.lowVillage, radius: 0.03, name: 'Lowmere' },
      { ...MB.westVillage, radius: 0.03, name: 'Ashby' },
      { ...MB.eastVillage, radius: 0.03, name: 'Highcliff' },
    ],
    sources: [
      { ...MB.westSpring, radius: 0.012, rate: 0.25 },
      { ...MB.eastSpring, radius: 0.012, rate: 0.25 },
    ],
    openEdges: edges({ south: true }),
    durationSec: 120,
    storm: [
      { t: 0, rain: 0 },
      { t: 15, rain: 0.0004 },
      { t: 40, rain: 0.0012 },
      { t: 70, rain: 0.0012 },
      { t: 95, rain: 0.0004 },
      { t: 120, rain: 0 },
    ],
    floodDepthThreshold: 0.5,
    floodSecondsToLose: 15,
    prefillSec: 10,
  },
];

const freePlay = (recipe: TerrainRecipe, sources: WaterSourceSpec[], openEdges: EdgeFlags, id = 'sandbox'): LevelDefinition => ({
  id,
  name: 'Free play',
  tagline: 'Free play: sculpt mountains, dig rivers and make it rain.',
  recipe,
  villages: [],
  sources,
  openEdges,
  durationSec: Infinity,
  storm: [],
  floodDepthThreshold: 0.5,
  floodSecondsToLose: 15,
  prefillSec: sources.length > 0 ? 12 : 0,
});

const spring = (at: { u: number; v: number }, rate: number): WaterSourceSpec => ({ ...at, radius: 0.015, rate });

/** Free-play landscapes: the level terrains with gentle springs and no villages, so there is living water to play with. */
const FREE_PLAY_LANDS: ((seed: number) => LevelDefinition)[] = [
  (seed) => freePlay({ kind: 'river-valley', seed }, [spring(RV.spring, 0.4)], edges({ east: true })),
  (seed) => freePlay({ kind: 'twin-valleys', seed }, [spring(TV.westSpring, 0.35), spring(TV.eastSpring, 0.35)], edges({ south: true })),
  (seed) => freePlay({ kind: 'mountain-basin', seed }, [spring(MB.westSpring, 0.3), spring(MB.eastSpring, 0.3)], edges({ south: true })),
];

export const FREE_PLAY_LAND_COUNT = FREE_PLAY_LANDS.length;

/** Free-play landscape `index` (wrapped) with its own noise seed; id stays 'sandbox' for the picker and URL. */
export function freePlayLevel(index: number, seed: number): LevelDefinition {
  const n = FREE_PLAY_LANDS.length;
  return FREE_PLAY_LANDS[((Math.trunc(index) % n) + n) % n](Math.trunc(seed));
}

export const SANDBOX_LEVEL: LevelDefinition = freePlayLevel(0, 1107);

/** Flat closed box without springs: a blank canvas, and projector mode's free play on real sand. */
export const BLANK_SANDBOX_LEVEL: LevelDefinition = {
  ...freePlay({ kind: 'flat', seed: 1 }, [], edges({}), 'blank'),
  name: 'Blank sand',
  tagline: 'A flat, empty box: build everything yourself.',
};

/** Looks up a level by id ('sandbox' and 'blank' included); unknown ids fall back to the first level. */
export function getLevel(id: string): LevelDefinition {
  if (id === SANDBOX_LEVEL.id) return SANDBOX_LEVEL;
  if (id === BLANK_SANDBOX_LEVEL.id) return BLANK_SANDBOX_LEVEL;
  return LEVELS.find((level) => level.id === id) ?? LEVELS[0];
}

/** Highest storm rain of a level (0 when it has no storm), used to scale the storm meter and visuals. */
export function peakStormRain(level: LevelDefinition): number {
  return level.storm.reduce((max, k) => Math.max(max, k.rain), 0);
}

/** Whether a level is free play (no villages, no clock). */
export function isFreePlay(level: LevelDefinition): boolean {
  return level.villages.length === 0;
}
