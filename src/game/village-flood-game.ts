// "Save the village" rules: villages accumulate flooded time while probe depth exceeds the level threshold.
import type { GridSize, VillageMarker, VillageState } from '../core/types';
import type { WaterProbe } from '../gpu/village-water-probe';
import type { LevelDefinition, StormKeyframe, VillageSpec } from './level-definitions';
import { assertValidGrid, layoutToCell } from './terrain-generators';

export { buildEmissionField } from './emission-field';

export type GamePhase = 'ready' | 'running' | 'won' | 'lost';

export interface VillageRuntime {
  spec: VillageSpec;
  x: number;
  y: number;
  radius: number;
  state: VillageState;
  floodedSec: number;
}

/** Longest step update() accepts; a stalled tab resuming with a huge dt must not drown villages instantly. */
export const MAX_UPDATE_DT_SEC = 1;
// Dry villages dry out at half the speed they flood.
const RECOVERY_RATE = 0.5;

/** Linear interpolation over keyframes sorted by t; values are held before the first and after the last. */
export function stormRainAt(storm: readonly StormKeyframe[], t: number): number {
  if (storm.length === 0) return 0;
  if (t <= storm[0].t) return Math.max(0, storm[0].rain);
  for (let i = 1; i < storm.length; i++) {
    const a = storm[i - 1];
    const b = storm[i];
    if (t <= b.t) {
      const span = b.t - a.t;
      const k = span > 0 ? (t - a.t) / span : 1;
      return Math.max(0, a.rain + (b.rain - a.rain) * k);
    }
  }
  return Math.max(0, storm[storm.length - 1].rain);
}

export class VillageFloodGame {
  readonly level: LevelDefinition;
  private readonly runtimes: VillageRuntime[];
  private readonly storm: StormKeyframe[];
  private currentPhase: GamePhase = 'ready';
  private elapsed = 0;

  constructor(level: LevelDefinition, grid: GridSize) {
    assertValidGrid(grid);
    this.level = level;
    this.storm = [...level.storm].sort((a, b) => a.t - b.t);
    const radiusScale = Math.max(1, grid.width - 1);
    this.runtimes = level.villages.map((spec) => ({
      spec,
      x: layoutToCell(spec.u, grid.width),
      y: layoutToCell(spec.v, grid.height),
      radius: Math.max(0, spec.radius) * radiusScale,
      state: 'safe' as VillageState,
      floodedSec: 0,
    }));
  }

  get phase(): GamePhase {
    return this.currentPhase;
  }

  get elapsedSec(): number {
    return this.elapsed;
  }

  get villages(): readonly VillageRuntime[] {
    return this.runtimes;
  }

  /** Starts the clock; starting a finished game begins a fresh attempt. */
  start(): void {
    if (this.currentPhase === 'running') return;
    if (this.currentPhase !== 'ready') this.reset();
    this.currentPhase = 'running';
  }

  reset(): void {
    this.currentPhase = 'ready';
    this.elapsed = 0;
    for (const v of this.runtimes) {
      v.state = 'safe';
      v.floodedSec = 0;
    }
  }

  /** `villageMaxDepths[i]` is the max water depth over village i; null (no readback yet) freezes flood state. */
  update(dtSec: number, villageMaxDepths: Float32Array | null): void {
    if (this.currentPhase !== 'running') return;
    if (!Number.isFinite(dtSec) || dtSec <= 0) return;
    const dt = Math.min(dtSec, MAX_UPDATE_DT_SEC);
    this.elapsed += dt;
    if (villageMaxDepths) this.accumulateFlooding(dt, villageMaxDepths);

    const total = this.runtimes.length;
    if (total === 0) return; // free play never ends
    const saved = this.runtimes.filter((v) => v.state !== 'lost').length;
    if (saved === 0) {
      this.currentPhase = 'lost';
    } else if (this.elapsed >= this.level.durationSec) {
      this.elapsed = this.level.durationSec;
      this.currentPhase = 'won';
    }
  }

  currentRainRate(): number {
    return stormRainAt(this.storm, this.elapsed);
  }

  markers(): VillageMarker[] {
    const lose = this.loseSeconds();
    return this.runtimes.map((v) => ({
      x: v.x,
      y: v.y,
      radius: v.radius,
      state: v.state,
      flood01: Math.min(1, Math.max(0, v.floodedSec / lose)),
    }));
  }

  probes(): WaterProbe[] {
    return this.runtimes.map((v) => ({ x: v.x, y: v.y, radius: v.radius }));
  }

  summary(): { saved: number; total: number; stars: 0 | 1 | 2 | 3 } {
    const total = this.runtimes.length;
    const saved = this.runtimes.filter((v) => v.state !== 'lost').length;
    let stars: 0 | 1 | 2 | 3 = 0;
    if (total > 0 && saved === total) stars = 3;
    else if (total > 0 && saved * 3 >= total * 2) stars = 2;
    else if (saved >= 1) stars = 1;
    return { saved, total, stars };
  }

  private loseSeconds(): number {
    const s = this.level.floodSecondsToLose;
    return Number.isFinite(s) && s > 0 ? s : Number.EPSILON;
  }

  private accumulateFlooding(dt: number, depths: Float32Array): void {
    const threshold = this.level.floodDepthThreshold;
    const lose = this.loseSeconds();
    this.runtimes.forEach((v, i) => {
      if (v.state === 'lost') return;
      const depth = i < depths.length ? depths[i] : 0;
      if (depth > threshold) {
        v.floodedSec = Math.min(lose, v.floodedSec + dt);
        v.state = v.floodedSec >= lose ? 'lost' : 'flooding';
      } else {
        v.floodedSec = Math.max(0, v.floodedSec - dt * RECOVERY_RATE);
        v.state = 'safe';
      }
    });
  }
}
