// Result shapes returned by the lava-sim harness page; shared by the page script and the Playwright spec.
import type { ScenarioErrors } from './water-sim-harness-api';

export interface LavaSlopeResult extends ScenarioErrors {
  lavaFrontBefore: number;
  lavaFrontAfter: number;
  lavaCentroidBefore: number;
  lavaCentroidAfter: number;
  waterFrontAfter: number;
  waterCentroidBefore: number;
  waterCentroidAfter: number;
  lowSideX: number;
  relMaterialError: number;
}

export interface LavaConservationResult extends ScenarioErrors {
  initial: number;
  final: number;
  lavaFinal: number;
  rockFinal: number;
  relError: number;
  minLava: number;
  nanCount: number;
}

export interface LavaCoolingResult extends ScenarioErrors {
  initialLava: number;
  finalLava: number;
  finalRock: number;
  /** Farthest rock cell (> 0.01) from the pile centre, in cells, versus the distance to the nearest wall. */
  extentRadius: number;
  wallDistance: number;
  /** max |terrain - (base + rock + lava)| after stepping, and after a zero-step encode on a new base. */
  terrainMaxAbsDiff: number;
  zeroStepMaxAbsDiff: number;
  terrainRiseAtCentre: number;
}

export interface LavaDamResult extends ScenarioErrors {
  emitted: number;
  material: number;
  relError: number;
  wallX: number;
  downstreamMaterial: number;
  materialNearWall: number;
  materialFrontX: number;
}

export interface LavaQuenchResult extends ScenarioErrors {
  waterInitial: number;
  waterFinal: number;
  controlWaterFinal: number;
  rockInPool: number;
  lavaInPool: number;
  /** Rock per unit of material that reached the pool (quench makes it close to 1). */
  poolSolidFraction: number;
  /** Same run with quenchPerSec = 0, so only ordinary cooling solidifies lava in the lake. */
  noQuenchPoolSolidFraction: number;
}

export interface LavaStabilityResult extends ScenarioErrors {
  initialMax: number;
  maxLavaSeen: number;
  nanCount: number;
  relMassError: number;
  minLava: number;
}

export interface LavaInputValidationResult extends ScenarioErrors {
  rangeErrorsThrown: number;
  rangeErrorsExpected: number;
  sanitizedNaN: number;
  sanitizedNegative: number;
  clearedLava: number;
  clearedRock: number;
  terrainAfterClearMaxAbsDiff: number;
  destroyedThrows: boolean;
}

export interface LavaSimHarnessApi {
  slope(): Promise<LavaSlopeResult>;
  conservation(): Promise<LavaConservationResult>;
  cooling(): Promise<LavaCoolingResult>;
  dam(): Promise<LavaDamResult>;
  quench(): Promise<LavaQuenchResult>;
  stability(): Promise<LavaStabilityResult>;
  inputValidation(): Promise<LavaInputValidationResult>;
  uncapturedErrors(): string[];
}

declare global {
  interface Window {
    __lavaSimHarness?: LavaSimHarnessApi;
    __lavaSimHarnessError?: string;
  }
}
