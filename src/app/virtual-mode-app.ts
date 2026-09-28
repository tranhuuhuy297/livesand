// Virtual mode: sculpt generated terrain with mouse/touch, save-the-village levels, 2D map and 3D orbit views.
import { DEFAULT_GRID } from '../core/types';
import { configureCanvas, type GpuContext } from '../gpu/gpu-context';
import { getLevel, LEVELS } from '../game/level-definitions';
import { defaultRelief } from '../game/terrain-generators';
import type { VillageFloodGame } from '../game/village-flood-game';
import type { SculptTool } from '../input/sculpt-tools';
import { OrbitCamera } from '../render/orbit-camera';
import { replaceUrlParam, type AppUrlParams, type ViewMode } from './app-url-params';
import { BrushCursorOverlay } from './brush-cursor-overlay';
import { CanvasStage } from './canvas-stage';
import { describeError, showFatalErrorScreen } from './fatal-error-screen';
import { FrameLoop } from './frame-loop';
import { GpuErrorMonitor } from './gpu-error-monitor';
import { h } from './hud-dom-helpers';
import { buildHudSnapshot, type HudSnapshot } from './hud-snapshot';
import { markLiveSandReady, publishDebugApi, reportLiveSandError } from './livesand-debug-api';
import { SandboxGpuScene } from './sandbox-gpu-scene';
import { MAX_STEPS_PER_FRAME, SandboxSession } from './sandbox-session';
import { BRUSH_RADIUS_DEFAULT, SIM_SPEEDS } from './sculpt-tool-settings';
import { createVirtualModeActions, type VirtualModeActions } from './virtual-mode-actions';
import { createVirtualModeDebugApi } from './virtual-mode-debug-api';
import { VirtualModeHud } from './virtual-mode-hud';
import { boxHeightRange, defaultToolFor, fitOrbitCameraToWindow, virtualRenderStyle } from './virtual-mode-presets';
import { wireVirtualModeInput, type VirtualModeInput } from './virtual-mode-input-wiring';
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
  private readonly input: VirtualModeInput;
  private readonly cursor = new BrushCursorOverlay();
  private readonly debug: boolean;
  view: ViewMode;
  tool: SculptTool;
  brushRadius = BRUSH_RADIUS_DEFAULT;
  speedIndex = 0;
  private timeSec = 0;
  private debugRefreshSec = 0;
  private sculptedGame: VillageFloodGame | null = null;
  private portrait = false;
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
    this.appRoot = h('div', { class: 'ls-app mode-virtual' }, [this.stage.root, this.cursor.element, this.hud.root]);
    root.replaceChildren(this.appRoot);

    const context = configureCanvas(gpu, this.stage.canvas);
    this.scene = new SandboxGpuScene(gpu, grid, context, virtualRenderStyle(this.relief));
    const level = params.levelId ? getLevel(params.levelId) : LEVELS[0];
    this.session = new SandboxSession(this.scene, level, { keepTerrain: false });
    this.camera = new OrbitCamera(grid);
    this.view = params.view ?? '3d';
    this.tool = defaultToolFor(level);
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
    this.syncLayout();
    const aspect = window.innerHeight > 0 ? window.innerWidth / window.innerHeight : 16 / 10;
    fitOrbitCameraToWindow(this.camera, this.session.grid, boxHeightRange(this.scene.renderStyle), aspect);
    this.tick(1 / 60);
    await this.gpu.device.queue.onSubmittedWorkDone();
    if (this.failed) return;
    publishDebugApi(createVirtualModeDebugApi(this));
    this.loop.start();
    markLiveSandReady();
  }

  /** One frame at `dtSim` simulated seconds; `draw` false skips canvas + HUD work (scripted fast-forward). */
  advance(dtSim: number, maxSteps: number, draw: boolean, dtReal: number): void {
    this.timeSec += dtReal;
    this.scene.setStyle({ timeSec: this.timeSec, stormLevel: this.session.stormLevel });
    const rotated = this.view === '2d' && this.portrait;
    this.session.frame({ dtSim, maxSteps, view: draw ? this.view : null, camera: this.camera, rotated });
    if (draw) this.hud.update(this.snapshot());
  }

  /** Scripted frame for the debug API: held pointer input + simulation, all at a fixed dt (on hold like live frames). */
  stepScripted(dt: number, draw: boolean): void {
    const paused = this.hud.pausesGame;
    if (paused) this.session.clearBrushRain();
    else this.input.pointer.applyFrame(dt);
    // Enough steps to consume the whole dt: scripted frames must never drop simulated time.
    this.advance(paused ? 0 : dt, Math.ceil(dt / this.session.simDt) + 1, draw, dt);
  }

  snapshot(): HudSnapshot {
    const { tool, brushRadius, view, speed } = this;
    const sculpted = this.sculptedGame === this.session.game;
    return buildHudSnapshot(this.session, { tool, brushRadius, view, speed, paused: this.hud.pausesGame, sculpted });
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
    const verticalScale = this.scene.renderStyle.verticalScale;
    const rect = this.stage.canvas.getBoundingClientRect();
    const rotated = this.view === '2d' && this.portrait;
    return { grid: this.session.grid, view: this.view, rect, camera: this.camera, verticalScale, heights: this.session.heights, rotated };
  }

  /** Portrait windows get the quarter-turned 2D map (CSS swaps its aspect), then the drawing buffer follows. */
  private syncLayout(): void {
    const portrait = window.innerWidth < window.innerHeight;
    if (portrait !== this.portrait) {
      this.portrait = portrait;
      this.appRoot.classList.toggle('is-portrait', portrait);
    }
    this.stage.syncSize();
  }

  private tick(dtReal: number): void {
    this.syncLayout();
    // Help, the real-sandbox dialog and the level menu hold the clock, the water and the rain brush.
    const paused = this.hud.pausesGame;
    if (paused) this.session.clearBrushRain();
    else this.input.pointer.applyFrame(dtReal);
    this.advance(paused ? 0 : dtReal * this.speed, MAX_STEPS_PER_FRAME * this.speed, true, dtReal);
    const { pointer } = this.input;
    this.cursor.update(this.geometry(), pointer.brushClient, this.tool, this.brushRadius, pointer.stroking);
    this.debugRefreshSec -= dtReal;
    if (this.debug && this.debugRefreshSec <= 0) {
      this.debugRefreshSec = 0.5;
      const { width, height } = this.stage.pixelSize;
      this.hud.setDebugText(`${this.loop.fps.toFixed(0)} fps · ${this.session.lastSteps} steps · ${width}×${height}`);
    }
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
