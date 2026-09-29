// "Save the village" rules: villages accumulate flooded time while probe water depth exceeds the level threshold, and
// burn down after a few seconds under molten lava.
import type { GridSize, VillageMarker, VillageState } from '../core/types';
import type { WaterProbe } from '../gpu/village-water-probe';
import type { LevelDefinition, StormKeyframe, VillageSpec } from './level-types';
import { assertValidGrid, layoutToCell } from './terrain-generators';

export { buildEmissionField } from './emission-field';

export type GamePhase = 'ready' | 'running' | 'won' | 'lost';
export type VillageLoss = 'flood' | 'lava';

export interface VillageRuntime {
  spec: VillageSpec;
  x: number;
  y: number;
  radius: number;
  state: VillageState;
  floodedSec: number;
  burnedSec: number;
  lostTo: VillageLoss | null;
}

/** Longest step update() accepts; a stalled tab resuming with a huge dt must not drown villages instantly. */
export const MAX_UPDATE_DT_SEC = 1;
/** Molten lava deeper than this over any village cell sets it on fire. */
export const LAVA_BURN_DEPTH = 0.1;
export const DEFAULT_BURN_SECONDS_TO_LOSE = 3;
// Dry villages dry out (and doused fires die down) at half the speed they flood or burn.
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

const positiveOr = (s: number | undefined, fallback: number): number => (s !== undefined && Number.isFinite(s) && s > 0 ? s : fallback);

export class VillageFloodGame {
  readonly level: LevelDefinition;
  private readonly runtimes: VillageRuntime[];
  private readonly storm: StormKeyframe[];
  // Eruption keyframes in storm form so both clocks share one interpolation.
  private readonly eruption: StormKeyframe[];
  private currentPhase: GamePhase = 'ready';
  private elapsed = 0;

  constructor(level: LevelDefinition, grid: GridSize) {
    assertValidGrid(grid);
    this.level = level;
    this.storm = [...level.storm].sort((a, b) => a.t - b.t);
    this.eruption = (level.eruption?.keyframes ?? []).map((k) => ({ t: k.t, rain: k.rate })).sort((a, b) => a.t - b.t);
    const radiusScale = Math.max(1, grid.width - 1);
    this.runtimes = level.villages.map((spec) => ({
      spec,
      x: layoutToCell(spec.u, grid.width),
      y: layoutToCell(spec.v, grid.height),
      radius: Math.max(0, spec.radius) * radiusScale,
      state: 'safe' as VillageState,
      floodedSec: 0,
      burnedSec: 0,
      lostTo: null,
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
      v.burnedSec = 0;
      v.lostTo = null;
    }
  }

  /**
   * `villageMaxDepths[i]` / `villageLavaDepths[i]`: max water / molten lava depth over village i. A null water
   * readback (none landed yet) freezes flooding; null lava means no lava anywhere.
   */
  update(dtSec: number, villageMaxDepths: Float32Array | null, villageLavaDepths: Float32Array | null = null): void {
    if (this.currentPhase !== 'running') return;
    if (!Number.isFinite(dtSec) || dtSec <= 0) return;
    const dt = Math.min(dtSec, MAX_UPDATE_DT_SEC);
    this.elapsed += dt;
    if (villageMaxDepths || villageLavaDepths) this.accumulateDamage(dt, villageMaxDepths, villageLavaDepths);

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

  /** Crater lava emission (units/s per crater cell) on the level clock; 0 without an eruption. */
  currentLavaRate(): number {
    return stormRainAt(this.eruption, this.elapsed);
  }

  markers(): VillageMarker[] {
    const flood = this.loseSeconds();
    const burn = this.burnSeconds();
    return this.runtimes.map((v) => {
      const burning = v.state === 'burning' || (v.state === 'lost' && v.lostTo === 'lava');
      const progress = burning ? v.burnedSec / burn : v.floodedSec / flood;
      return { x: v.x, y: v.y, radius: v.radius, state: v.state, flood01: Math.min(1, Math.max(0, progress)) };
    });
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
    return positiveOr(this.level.floodSecondsToLose, Number.EPSILON);
  }

  private burnSeconds(): number {
    return positiveOr(this.level.burnSecondsToLose, DEFAULT_BURN_SECONDS_TO_LOSE);
  }

  private accumulateDamage(dt: number, water: Float32Array | null, lava: Float32Array | null): void {
    const threshold = this.level.floodDepthThreshold;
    const floodLimit = this.loseSeconds();
    const burnLimit = this.burnSeconds();
    this.runtimes.forEach((v, i) => {
      if (v.state === 'lost') return;
      let flooded = v.state === 'flooding';
      if (water) {
        flooded = (i < water.length ? water[i] : 0) > threshold;
        v.floodedSec = flooded ? Math.min(floodLimit, v.floodedSec + dt) : Math.max(0, v.floodedSec - dt * RECOVERY_RATE);
      }
      const burning = (lava && i < lava.length ? lava[i] : 0) > LAVA_BURN_DEPTH;
      v.burnedSec = burning ? Math.min(burnLimit, v.burnedSec + dt) : Math.max(0, v.burnedSec - dt * RECOVERY_RATE);
      if (v.floodedSec >= floodLimit) this.lose(v, 'flood');
      else if (v.burnedSec >= burnLimit) this.lose(v, 'lava');
      else v.state = burning ? 'burning' : flooded ? 'flooding' : 'safe';
    });
  }

  private lose(v: VillageRuntime, cause: VillageLoss): void {
    v.state = 'lost';
    v.lostTo = cause;
  }
}
