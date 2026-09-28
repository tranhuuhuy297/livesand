// CPU-side sandbox shared by virtual and projector modes: heightmap, emission, level + game, fixed-step sim timing.
import type { GridSize } from '../core/types';
import { sourceMarkers } from '../game/emission-field';
import { isFreePlay, peakStormRain, type LevelDefinition } from '../game/level-definitions';
import { generateTerrain } from '../game/terrain-generators';
import { VillageFloodGame } from '../game/village-flood-game';
import { buildVillageSculptFloor } from '../game/village-sculpt-floor';
import type { OrbitCamera } from '../render/orbit-camera';
import type { ViewMode } from './app-url-params';
import type { SandboxGpuScene } from './sandbox-gpu-scene';
import { SessionEmissionField } from './session-emission-field';

/** Real-time cap on sim steps per frame; a slow frame drops sim time instead of spiralling. */
export const MAX_STEPS_PER_FRAME = 8;
/** Global rain of the free-play "Make it rain" toggle (units/s per cell): enough to pool in every hollow. */
export const FREE_PLAY_RAIN_RATE = 0.004;

export interface SessionFrameOptions {
  /** Simulated seconds to advance (already scaled by any speed-up). */
  dtSim: number;
  maxSteps: number;
  view: ViewMode | null;
  camera: OrbitCamera | null;
  /** 2D only: map turned a quarter for portrait screens. */
  rotated?: boolean;
}

export class SandboxSession {
  readonly grid: GridSize;
  readonly heights: Float32Array;
  totalSteps = 0;
  lastSteps = 0;
  private readonly scene: SandboxGpuScene;
  private readonly emission: SessionEmissionField;
  private readonly keepTerrain: boolean;
  private currentLevel!: LevelDefinition;
  private currentGame!: VillageFloodGame;
  private terrainDirty = true;
  private accumulator = 0;
  private levelVersion = 0;
  private floor: Float32Array | null = null;
  private freeRain = false;

  /** keepTerrain: the heightmap comes from outside (depth camera), so levels never regenerate it. */
  constructor(scene: SandboxGpuScene, level: LevelDefinition, opts: { keepTerrain: boolean }) {
    this.scene = scene;
    this.grid = scene.sim.grid;
    this.heights = new Float32Array(this.grid.width * this.grid.height);
    this.emission = new SessionEmissionField(this.grid);
    this.keepTerrain = opts.keepTerrain;
    this.loadLevel(level);
  }

  get level(): LevelDefinition {
    return this.currentLevel;
  }

  get game(): VillageFloodGame {
    return this.currentGame;
  }

  get simDt(): number {
    return this.scene.sim.params.dt;
  }

  /** Levels wait on their intro card with the water frozen after the prefill; free play runs immediately. */
  get simRunning(): boolean {
    return this.currentGame.phase !== 'ready';
  }

  /** Village ground may be built up but not dug below its loaded height (null: no villages or external terrain). */
  get sculptFloor(): Float32Array | null {
    return this.floor;
  }

  /** 0..1 storm strength for the rain visuals: the level storm relative to its peak, or the free-play rain toggle. */
  get stormLevel(): number {
    if (isFreePlay(this.currentLevel)) return this.freeRain ? 1 : 0;
    const peak = peakStormRain(this.currentLevel);
    if (!(peak > 0) || this.currentGame.phase !== 'running') return 0;
    return Math.min(1, Math.max(0, this.currentGame.currentRainRate() / peak));
  }

  get freePlayRain(): boolean {
    return this.freeRain;
  }

  /** Free play only: global rain on or off. */
  setFreePlayRain(on: boolean): void {
    this.freeRain = on && isFreePlay(this.currentLevel);
  }

  /** Loads (or restarts) a level: fresh terrain unless external, springs pre-run, new game in the ready phase. */
  loadLevel(level: LevelDefinition): void {
    this.currentLevel = level;
    this.currentGame = new VillageFloodGame(level, this.grid);
    if (!isFreePlay(level)) this.freeRain = false;
    if (!this.keepTerrain) this.heights.set(generateTerrain(this.grid, level.recipe));
    this.floor = this.keepTerrain ? null : buildVillageSculptFloor(this.heights, this.grid, this.currentGame.villages);
    this.terrainDirty = true;
    this.scene.setOpenEdges(level.openEdges);
    this.scene.sim.clearWater();
    this.scene.setProbes(this.currentGame.probes());
    this.scene.setVillages(this.currentGame.markers());
    this.scene.setSources(sourceMarkers(this.grid, level.sources));
    this.accumulator = 0;
    this.levelVersion++;
    this.prefill(level);
    if (isFreePlay(level)) this.currentGame.start();
  }

  startGame(): void {
    if (this.currentGame.phase === 'won' || this.currentGame.phase === 'lost') {
      this.loadLevel(this.currentLevel);
    }
    this.currentGame.start();
  }

  markTerrainDirty(): void {
    this.terrainDirty = true;
  }

  setHandMask(mask: Uint8Array | null): void {
    this.emission.setHandMask(mask);
  }

  /** Rain follows the cursor: the field is repainted every frame the brush is held and cleared when released. */
  paintBrushRain(cx: number, cy: number, radius: number): void {
    this.emission.paintBrush(cx, cy, radius);
  }

  clearBrushRain(): void {
    this.emission.clearBrush();
  }

  /** One frame: uploads, fixed sim steps, probes, drawing, then the game clock advances by the simulated time. */
  frame(opts: SessionFrameOptions): void {
    const sim = this.scene.sim;
    if (this.terrainDirty) {
      sim.uploadTerrain(this.heights);
      this.terrainDirty = false;
    }
    const dt = this.simDt;
    let steps = 0;
    if (this.simRunning && opts.dtSim > 0) {
      this.accumulator += opts.dtSim;
      steps = Math.min(Math.floor(this.accumulator / dt + 1e-6), Math.max(0, opts.maxSteps));
      this.accumulator = Math.min(this.accumulator - steps * dt, dt);
    }
    this.updateEmission();
    this.scene.setVillages(this.currentGame.markers());
    this.scene.submitFrame({ steps, view: opts.view, camera: opts.camera, rotated: opts.rotated });
    this.lastSteps = steps;
    this.totalSteps += steps;
    if (steps > 0) this.currentGame.update(steps * dt, this.scene.probeValues());
  }

  readWater(): Promise<Float32Array> {
    return this.scene.sim.readWater();
  }

  /** Runs the springs for the level's prefill time so the first frame already shows rivers and a filling lake. */
  private prefill(level: LevelDefinition): void {
    const steps = this.keepTerrain ? 0 : Math.round((level.prefillSec ?? 0) / this.simDt);
    if (!(steps > 0)) return;
    this.scene.sim.uploadTerrain(this.heights);
    this.terrainDirty = false;
    this.updateEmission();
    this.scene.runSteps(steps);
  }

  private updateEmission(): void {
    const game = this.currentGame;
    const freeRain = this.freeRain && isFreePlay(this.currentLevel) ? FREE_PLAY_RAIN_RATE : 0;
    const rain = game.phase === 'running' ? game.currentRainRate() + freeRain : 0;
    const field = this.emission.update(this.levelVersion, this.currentLevel.sources, rain);
    if (field) this.scene.sim.uploadEmission(field);
  }
}
