// Virtual mode: sculpt generated terrain with mouse/touch, save-the-village levels, 2D map and 3D orbit views.
import { DEFAULT_GRID } from '../core/types';
import { configureCanvas, type GpuContext } from '../gpu/gpu-context';
import { defaultRelief } from '../game/terrain-generators';
import type { VillageFloodGame } from '../game/village-flood-game';
import { OrbitCamera } from '../render/orbit-camera';
import type { LevelDefinition } from '../game/level-definitions';
import { replaceUrlParam, type AppUrlParams, type ViewMode } from './app-url-params';
import { CanvasStage } from './canvas-stage';
import { describeError, showFatalErrorScreen } from './fatal-error-screen';
import { FrameLoop } from './frame-loop';
import { GpuErrorMonitor } from './gpu-error-monitor';
import { h } from './hud-dom-helpers';
import { buildHudSnapshot, type HudSnapshot } from './hud-snapshot';
import { markLiveSandReady, publishDebugApi, reportLiveSandError } from './livesand-debug-api';
import { SandboxGpuScene } from './sandbox-gpu-scene';
import { MAX_STEPS_PER_FRAME, SandboxSession } from './sandbox-session';
import { PlaceTerrainLoader } from './place-terrain-loader';
import { BRUSH_RADIUS_DEFAULT, SIM_SPEEDS, type AppTool } from './sculpt-tool-settings';
import { startupLevels, VirtualLevelFlow } from './virtual-level-flow';
import { createVirtualModeActions, type VirtualModeActions } from './virtual-mode-actions';
import { createVirtualModeDebugApi } from './virtual-mode-debug-api';
import { VirtualModeHud } from './virtual-mode-hud';
import { boxHeightRange, defaultToolFor, fitOrbitCameraToWindow, virtualRenderStyle } from './virtual-mode-presets';
import { wireVirtualModeInput, type VirtualModeInput } from './virtual-mode-input-wiring';
import { VirtualModeScreen } from './virtual-mode-screen';
import type { ViewGeometry } from './view-screen-mapping';

export async function startVirtualMode(gpu: GpuContext, root: HTMLElement, params: AppUrlParams): Promise<VirtualModeApp> {
  const app = new VirtualModeApp(gpu, root, params);
  await app.start();
  return app;
}

export class VirtualModeApp {
  readonly gpu: GpuContext;
  readonly stage: CanvasStage;
  readonly scene: SandboxGpuScene;
  readonly session: SandboxSession;
  readonly camera: OrbitCamera;
  readonly loop: FrameLoop;
  readonly monitor: GpuErrorMonitor;
  private readonly root: HTMLElement;
  private readonly appRoot: HTMLDivElement;
  readonly hud: VirtualModeHud;
  readonly actions: VirtualModeActions;
  readonly relief: number;
  readonly levels: VirtualLevelFlow;
  private readonly input: VirtualModeInput;
  private readonly screen: VirtualModeScreen;
  private readonly debug: boolean;
  view: ViewMode;
  tool: AppTool;
  brushRadius = BRUSH_RADIUS_DEFAULT;
  speedIndex = 0;
  private timeSec = 0;
  private sculptedGame: VillageFloodGame | null = null;
  // Real seconds since the attempt was won or lost: the result card waits so the aftermath is seen first.
  private endedSec = 0;
  private failed = false;

  constructor(gpu: GpuContext, root: HTMLElement, params: AppUrlParams) {
    const grid = DEFAULT_GRID;
    this.gpu = gpu;
    this.root = root;
    this.debug = params.debug;
    this.relief = defaultRelief(grid);
    this.stage = new CanvasStage(grid);
    this.actions = createVirtualModeActions(this);
    this.hud = new VirtualModeHud(this.actions);
    this.appRoot = h('div', { class: 'ls-app mode-virtual' }, [this.stage.root]);
    this.screen = new VirtualModeScreen(this.appRoot, this.stage);
    this.appRoot.append(...this.screen.elements, this.hud.root);
    root.replaceChildren(this.appRoot);

    const context = configureCanvas(gpu, this.stage.canvas);
    this.scene = new SandboxGpuScene(gpu, grid, context, virtualRenderStyle(this.relief), { lava: true });
    const startup = startupLevels(params);
    this.session = new SandboxSession(this.scene, startup.level, { keepTerrain: false });
    this.levels = new VirtualLevelFlow({
      session: this.session,
      scene: this.scene,
      relief: this.relief,
      onLevelApplied: (applied) => this.onLevelApplied(applied),
      showToast: (message) => this.hud.showToast(message),
    }, new PlaceTerrainLoader(grid), startup.pending);
    this.camera = new OrbitCamera(grid);
    this.view = params.view ?? '3d';
    this.tool = defaultToolFor(startup.level);
    this.loop = new FrameLoop((dt) => this.tick(dt), (err) => this.fail(err));
    this.monitor = new GpuErrorMonitor(gpu.device, (msg) => this.fail(new Error(msg)));
    this.input = wireVirtualModeInput(this);
    this.appRoot.classList.add(`view-${this.view}`);
  }

  get speed(): number {
    return SIM_SPEEDS[this.speedIndex];
  }

  /** Draws the first frame, waits for the GPU, then hands over to the rAF loop and flags readiness. */
  async start(): Promise<void> {
    this.screen.sync();
    this.fitCamera();
    this.tick(1 / 60);
    await this.gpu.device.queue.onSubmittedWorkDone();
    if (this.failed) return;
    publishDebugApi(createVirtualModeDebugApi(this));
    this.loop.start();
    await this.levels.loadStartupLevel();
    markLiveSandReady();
  }

  /** One frame at `dtSim` simulated seconds; `draw` false skips canvas + HUD work (scripted fast-forward). */
  advance(dtSim: number, maxSteps: number, draw: boolean, dtReal: number): void {
    this.timeSec += dtReal;
    this.scene.setStyle({ timeSec: this.timeSec, stormLevel: this.session.stormLevel, ashLevel: this.session.ashLevel });
    const rotated = this.screen.rotated(this.view);
    this.session.frame({ dtSim, maxSteps, view: draw ? this.view : null, camera: this.camera, rotated });
    const { phase } = this.session.game;
    this.endedSec = phase === 'won' || phase === 'lost' ? this.endedSec + dtReal : 0;
    if (draw) this.hud.update(this.snapshot());
  }

  /** Scripted frame for the debug API: held pointer input + simulation, all at a fixed dt (on hold like live frames). */
  stepScripted(dt: number, draw: boolean): void {
    const paused = this.applyInput(dt);
    // Enough steps to consume the whole dt: scripted frames must never drop simulated time.
    this.advance(paused ? 0 : dt, Math.ceil(dt / this.session.simDt) + 1, draw, dt);
  }

  snapshot(): HudSnapshot {
    const { tool, brushRadius, view, speed } = this;
    const sculpted = this.sculptedGame === this.session.game;
    const { loading, place, hasFreePlace } = this.levels;
    const ui = { tool, brushRadius, view, speed, paused: this.hud.pausesGame, sculpted, loading, place, hasFreePlace, endedSec: this.endedSec };
    return buildHudSnapshot(this.session, ui);
  }

  /** The current attempt has been sculpted on (changes the advice after a loss). */
  markSculpted(): void {
    this.sculptedGame = this.session.game;
  }

  setView(view: ViewMode): void {
    if (view === this.view) return;
    this.appRoot.classList.replace(`view-${this.view}`, `view-${view}`);
    this.view = view;
    replaceUrlParam('view', view);
  }

  geometry(): ViewGeometry {
    const { grid, heights } = this.session;
    const rect = this.stage.canvas.getBoundingClientRect();
    return { grid, view: this.view, rect, camera: this.camera, verticalScale: this.scene.renderStyle.verticalScale, heights, rotated: this.screen.rotated(this.view) };
  }

  /** New level: its starting tool; real maps turn the map back north-up (refitting a portrait 3D camera). */
  private onLevelApplied(level: LevelDefinition): void {
    this.tool = defaultToolFor(level);
    if (this.screen.setNorthUp(Boolean(level.place)) && this.screen.isPortrait) this.fitCamera();
  }

  private fitCamera(): void {
    const aspect = window.innerHeight > 0 ? window.innerWidth / window.innerHeight : 16 / 10;
    fitOrbitCameraToWindow(this.camera, this.session.grid, boxHeightRange(this.scene.renderStyle), aspect, Boolean(this.session.level.place));
  }

  private tick(dtReal: number): void {
    this.screen.sync();
    const paused = this.applyInput(dtReal);
    this.advance(paused ? 0 : dtReal * this.speed, MAX_STEPS_PER_FRAME * this.speed, true, dtReal);
    const { pointer } = this.input;
    const brush = { client: pointer.brushClient, tool: this.tool, radius: this.brushRadius, active: pointer.stroking };
    this.screen.drawOverlays(this.geometry(), this.session, brush);
    if (this.debug) this.hud.tickDebug(dtReal, () => `${this.loop.fps.toFixed(0)} fps · ${this.session.lastSteps} steps · ${this.stage.pixelSize.width}×${this.stage.pixelSize.height}`);
  }

  /** Help, dialogs and the level menu hold the clock, the water and the rain/lava brushes; returns whether paused. */
  private applyInput(dt: number): boolean {
    const paused = this.hud.pausesGame;
    if (!paused) this.input.pointer.applyFrame(dt);
    else {
      this.session.clearBrushRain();
      this.session.lava.clearBrush();
    }
    return paused;
  }

  private fail(err: unknown): void {
    if (this.failed) return;
    this.failed = true;
    const message = describeError(err);
    console.error('[livesand] fatal:', err);
    this.loop.stop();
    this.input.detach();
    reportLiveSandError(message);
    showFatalErrorScreen(this.root, message);
  }
}
