// CPU-side sandbox shared by virtual and projector modes: heightmap, emission, level + game, fixed-step sim timing.
import type { GridSize } from '../core/types';
import { sourceMarkers } from '../game/emission-field';
import { isFreePlay, type LevelDefinition } from '../game/level-definitions';
import { VillageFloodGame } from '../game/village-flood-game';
import { riverPrefillEmission } from '../game/terrain-flow-routing';
import { buildVillageSculptFloor } from '../game/village-sculpt-floor';
import type { SandboxGpuScene } from './sandbox-gpu-scene';
import { FREE_PLAY_RAIN_RATE, LAVA_NEAR_DEPTH, SANDBOX_LAVA_FLOW, type SessionFrameOptions } from './sandbox-session-settings';
import { ashLevelOf, stormLevelOf } from './session-atmosphere';
import { SessionEmissionField } from './session-emission-field';
import { LevelTerrainSource } from './session-level-terrain';
import { eruptionCrater, SessionLavaField } from './session-lava-field';

export { FREE_PLAY_RAIN_RATE, MAX_STEPS_PER_FRAME, SANDBOX_LAVA_FLOW, type SessionFrameOptions } from './sandbox-session-settings';

export class SandboxSession {
  readonly grid: GridSize;
  readonly heights: Float32Array;
  /** Crater + lava brush emission; `active` while lava is emitted or still flowing (lava steps run only then). */
  readonly lava: SessionLavaField;
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
  private nearLava: boolean[] = [];
  private readonly terrain: LevelTerrainSource;

  /** keepTerrain: the heightmap comes from outside (depth camera), so levels never regenerate it. */
  constructor(scene: SandboxGpuScene, level: LevelDefinition, opts: { keepTerrain: boolean }) {
    this.scene = scene;
    this.grid = scene.sim.grid;
    this.heights = new Float32Array(this.grid.width * this.grid.height);
    this.emission = new SessionEmissionField(this.grid);
    this.lava = new SessionLavaField(this.grid);
    this.keepTerrain = opts.keepTerrain;
    this.terrain = new LevelTerrainSource(this.grid);
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

  get stormLevel(): number {
    return stormLevelOf(this.currentLevel, this.currentGame, this.freeRain);
  }

  get ashLevel(): number {
    return ashLevelOf(this.currentLevel, this.currentGame);
  }

  /** Per village: molten lava within a couple of village radii, from the latest lava probe readback. */
  get lavaNear(): readonly boolean[] {
    return this.nearLava;
  }

  get freePlayRain(): boolean {
    return this.freeRain;
  }

  /** Free play only: global rain on or off. */
  setFreePlayRain(on: boolean): void {
    this.freeRain = on && isFreePlay(this.currentLevel);
  }

  /**
   * Loads (or restarts) a level: fresh terrain unless external, lava and rock cleared, springs pre-run, new game in
   * the ready phase. Real-place levels need `terrain` the first time; restarts reuse it.
   */
  loadLevel(level: LevelDefinition, terrain?: Float32Array): void {
    const heights = this.keepTerrain ? null : this.terrain.heightsFor(level, terrain);
    this.currentLevel = level;
    this.currentGame = new VillageFloodGame(level, this.grid);
    if (!isFreePlay(level)) this.freeRain = false;
    if (heights) this.heights.set(heights);
    this.floor = this.keepTerrain ? null : buildVillageSculptFloor(this.heights, this.grid, this.currentGame.villages);
    this.terrainDirty = true;
    this.scene.setOpenEdges(level.openEdges);
    this.scene.setLavaParams({ ...SANDBOX_LAVA_FLOW, ...level.lavaFlow, openEdges: level.openEdges });
    this.scene.lava?.clear();
    this.lava.reset();
    this.nearLava = [];
    // Eruption levels compile the lava shaders now, under the briefing, rather than when the crater first spills.
    this.scene.setLavaVisible(level.eruption !== undefined);
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
    if (this.terrainDirty) {
      this.scene.uploadTerrain(this.heights);
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
    const lava = this.lava.active && this.scene.lava !== null;
    if (lava) this.scene.setLavaVisible(true);
    this.scene.setVillages(this.currentGame.markers());
    this.scene.submitFrame({ steps, lavaSteps: lava ? steps : 0, probeLava: lava, view: opts.view, camera: opts.camera, rotated: opts.rotated });
    this.lastSteps = steps;
    this.totalSteps += steps;
    const reading = lava ? this.scene.lavaReading() : null;
    this.nearLava = reading ? Array.from(reading.near, (d) => d > LAVA_NEAR_DEPTH) : [];
    this.lava.track(steps > 0, reading?.max ?? null);
    if (steps > 0) this.currentGame.update(steps * dt, this.scene.probeValues(), reading?.villages ?? null);
  }

  /** Runs the springs (and any prefill rain, routed into the rivers) so the first frame already shows rivers and lakes. */
  private prefill(level: LevelDefinition): void {
    const steps = this.keepTerrain ? 0 : Math.round((level.prefillSec ?? 0) / this.simDt);
    if (!(steps > 0)) return;
    this.scene.uploadTerrain(this.heights);
    this.terrainDirty = false;
    this.updateEmission(level.prefillRain ? riverPrefillEmission(this.heights, this.grid, level.prefillRain) : null);
    this.scene.runSteps(steps);
  }

  /** `prefill` is the level load's river water, poured only while the prefill runs. */
  private updateEmission(prefill: Float32Array | null = null): void {
    const game = this.currentGame;
    const running = game.phase === 'running';
    const freeRain = this.freeRain && isFreePlay(this.currentLevel) ? FREE_PLAY_RAIN_RATE : 0;
    const field = this.emission.update(this.levelVersion, this.currentLevel.sources, running ? game.currentRainRate() + freeRain : 0, prefill);
    if (field) this.scene.sim.uploadEmission(field);
    const lavaField = this.scene.lava ? this.lava.update(this.levelVersion, eruptionCrater(this.currentLevel, game)) : null;
    if (lavaField) this.scene.lava?.uploadEmission(lavaField);
  }
}
