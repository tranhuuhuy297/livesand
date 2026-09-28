// CPU-side sandbox shared by virtual and projector modes: heightmap, emission, level + game, fixed-step sim timing.
import type { GridSize } from '../core/types';
import type { LevelDefinition } from '../game/level-definitions';
import { generateTerrain } from '../game/terrain-generators';
import { buildEmissionField, VillageFloodGame } from '../game/village-flood-game';
import { paintRainBrush } from '../input/sculpt-tools';
import type { OrbitCamera } from '../render/orbit-camera';
import type { ViewMode } from './app-url-params';
import type { SandboxGpuScene } from './sandbox-gpu-scene';

/** Real-time cap on sim steps per frame; a slow frame drops sim time instead of spiralling. */
export const MAX_STEPS_PER_FRAME = 8;
/** Rain brush and hand rain intensity at the centre (world units/s per cell). */
export const BRUSH_RAIN_RATE = 0.4;
export const HAND_RAIN_RATE = 0.5;

export interface SessionFrameOptions {
  /** Simulated seconds to advance (already scaled by any speed-up). */
  dtSim: number;
  maxSteps: number;
  view: ViewMode | null;
  camera: OrbitCamera | null;
}

export class SandboxSession {
  readonly grid: GridSize;
  readonly heights: Float32Array;
  totalSteps = 0;
  lastSteps = 0;
  private readonly scene: SandboxGpuScene;
  private readonly brushRain: Float32Array;
  private readonly emission: Float32Array;
  private currentLevel!: LevelDefinition;
  private currentGame!: VillageFloodGame;
  private readonly keepTerrain: boolean;
  private handMask: Uint8Array | null = null;
  private handVersion = 0;
  private brushActive = false;
  private brushFrame = 0;
  private emissionKey = '';
  private terrainDirty = true;
  private accumulator = 0;
  private levelVersion = 0;

  /** keepTerrain: the heightmap comes from outside (depth camera), so levels never regenerate it. */
  constructor(scene: SandboxGpuScene, level: LevelDefinition, opts: { keepTerrain: boolean }) {
    this.scene = scene;
    this.grid = scene.sim.grid;
    const cells = this.grid.width * this.grid.height;
    this.heights = new Float32Array(cells);
    this.brushRain = new Float32Array(cells);
    this.emission = new Float32Array(cells);
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

  /** Levels wait on their intro card with the water frozen; free play (no villages) runs immediately. */
  get simRunning(): boolean {
    return this.currentGame.phase !== 'ready';
  }

  /** Loads (or restarts) a level: fresh terrain unless external, dry map, new game in the ready phase. */
  loadLevel(level: LevelDefinition): void {
    this.currentLevel = level;
    this.currentGame = new VillageFloodGame(level, this.grid);
    if (!this.keepTerrain) this.heights.set(generateTerrain(this.grid, level.recipe));
    this.terrainDirty = true;
    this.scene.setOpenEdges(level.openEdges);
    this.scene.sim.clearWater();
    this.scene.setProbes(this.currentGame.probes());
    this.scene.setVillages(this.currentGame.markers());
    this.accumulator = 0;
    this.levelVersion++;
    if (level.villages.length === 0) this.currentGame.start();
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
    this.handMask = mask && mask.length === this.heights.length ? mask : null;
    this.handVersion++;
  }

  /** Rain follows the cursor: the field is repainted every frame the brush is held and cleared when released. */
  paintBrushRain(cx: number, cy: number, radius: number): void {
    this.brushRain.fill(0);
    paintRainBrush(this.brushRain, this.grid, cx, cy, radius, BRUSH_RAIN_RATE);
    this.brushActive = true;
    this.brushFrame++;
  }

  clearBrushRain(): void {
    if (!this.brushActive) return;
    this.brushRain.fill(0);
    this.brushActive = false;
    this.brushFrame++;
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
    this.scene.submitFrame({ steps, view: opts.view, camera: opts.camera });
    this.lastSteps = steps;
    this.totalSteps += steps;
    if (steps > 0) this.currentGame.update(steps * dt, this.scene.probeValues());
  }

  readWater(): Promise<Float32Array> {
    return this.scene.sim.readWater();
  }

  private updateEmission(): void {
    const game = this.currentGame;
    const rain = game.phase === 'running' ? game.currentRainRate() : 0;
    const key = `${this.levelVersion}|${rain}|${this.brushFrame}|${this.handVersion}`;
    if (key === this.emissionKey) return;
    this.emissionKey = key;
    const brush = this.brushActive ? this.brushRain : null;
    buildEmissionField(this.grid, this.currentLevel.sources, rain, brush, this.handMask, HAND_RAIN_RATE, this.emission);
    this.scene.sim.uploadEmission(this.emission);
  }
}
