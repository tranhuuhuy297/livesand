// Level data model shared by the level catalogue, the game rules and the app (layout u,v in 0..1, north = v 0).
import type { EdgeFlags } from '../core/types';
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

/** Crater lava emission (units/s per covered cell) at time t (s); interpolated like the storm. */
export interface EruptionKeyframe {
  t: number;
  rate: number;
}

/** A crater pouring lava: placed like a spring, its output following the keyframes on the level clock. */
export interface EruptionSpec {
  u: number;
  v: number;
  radius: number;
  keyframes: EruptionKeyframe[];
}

/** A straight stroke the briefing suggests, drawn as a pulsing dashed line early in each attempt (u,v like villages). */
export interface LevelHint {
  from: { u: number; v: number };
  to: { u: number; v: number };
  tool: 'raise' | 'lower';
}

/** Real-world terrain replacing the procedural recipe: a baked place id, or live tiles around lat/lon. */
export type PlaceRef = { id: string } | { lat: number; lon: number; widthKm: number };

export interface LevelDefinition {
  id: string;
  name: string;
  tagline: string;
  /** Procedural terrain; ignored when `place` supplies real terrain. */
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
  /** Global rain (units/s per cell) during the prefill only, so real maps open with water in their rivers and lakes. */
  prefillRain?: number;
  /** Tool selected when the level loads (default: Dig on levels, Raise in free play). */
  startTool?: 'raise' | 'lower';
  hint?: LevelHint;
  eruption?: EruptionSpec;
  place?: PlaceRef;
  /** Seconds of molten lava over a village that burn it down (default DEFAULT_BURN_SECONDS_TO_LOSE). */
  burnSecondsToLose?: number;
  /** Lava rheology for this level (the sandbox defaults otherwise): less damping = runnier lava. */
  lavaFlow?: LavaFlowSpec;
}

export interface LavaFlowSpec {
  damping?: number;
  coolingPerSec?: number;
}

export const edges = (open: Partial<EdgeFlags>): EdgeFlags => ({ north: false, east: false, south: false, west: false, ...open });
