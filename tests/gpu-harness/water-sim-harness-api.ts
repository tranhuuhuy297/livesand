// Result shapes returned by the water-sim harness page; shared by the page script and the Playwright spec.

export interface ScenarioErrors {
  /** GPU validation/internal errors captured by error scopes plus uncaptured errors raised during the scenario. */
  errors: string[];
}

export interface ConservationResult extends ScenarioErrors {
  initial: number;
  final: number;
  relError: number;
  minDepth: number;
  nanCount: number;
}

export interface DownhillResult extends ScenarioErrors {
  centroidBefore: number;
  centroidAfter: number;
  lowSideX: number;
  relMassError: number;
}

export interface DrainResult extends ScenarioErrors {
  initial: number;
  openFinal: number;
  closedFinal: number;
}

export interface EmissionResult extends ScenarioErrors {
  expectedPerCell: number;
  meanPerCell: number;
  minPerCell: number;
  maxPerCell: number;
  springExpectedTotal: number;
  springTotal: number;
  evaporationExpected: number;
  evaporationMean: number;
}

export interface ProbeResult extends ScenarioErrors {
  gpuA: number[];
  cpuA: number[];
  gpuB: number[];
  cpuB: number[];
  maxAbsDiff: number;
  staleClearedOnSetProbes: boolean;
  emptyProbeResultLength: number;
}

export interface StabilityResult extends ScenarioErrors {
  initialMax: number;
  maxDepthSeen: number;
  nanCount: number;
  relMassError: number;
}

export interface InputValidationResult extends ScenarioErrors {
  rangeErrorsThrown: number;
  rangeErrorsExpected: number;
  sanitizedNaN: number;
  sanitizedNegative: number;
}

export interface CanvasResult extends ScenarioErrors {
  format: string;
  alphaMode: string;
}

export interface WaterSimHarnessApi {
  conservation(): Promise<ConservationResult>;
  downhill(): Promise<DownhillResult>;
  drain(): Promise<DrainResult>;
  emission(): Promise<EmissionResult>;
  probe(): Promise<ProbeResult>;
  stability(): Promise<StabilityResult>;
  inputValidation(): Promise<InputValidationResult>;
  canvas(): Promise<CanvasResult>;
  uncapturedErrors(): string[];
}

declare global {
  interface Window {
    __waterSimHarness?: WaterSimHarnessApi;
    __waterSimHarnessError?: string;
  }
}
