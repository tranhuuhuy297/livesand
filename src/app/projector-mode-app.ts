// Projector mode: black full-screen top-down view corner-pinned onto real sand; terrain and hand rain come from
// the iPhone depth stream through PhysicalModeController.
import { DEFAULT_GRID } from '../core/types';
import { configureCanvas, type GpuContext } from '../gpu/gpu-context';
import { BLANK_SANDBOX_LEVEL, getLevel, isFreePlay } from '../game/level-definitions';
import { urlForMode, type AppUrlParams } from './app-url-params';
import { CanvasStage } from './canvas-stage';
import { describeError, showFatalErrorScreen } from './fatal-error-screen';
import { FrameLoop } from './frame-loop';
import { GpuErrorMonitor } from './gpu-error-monitor';
import { formatClock, h, isTypingTarget } from './hud-dom-helpers';
import { toggleDocumentFullscreen } from './keyboard-shortcuts';
import { markLiveSandReady, publishDebugApi, reportLiveSandError } from './livesand-debug-api';
import { defaultRelayUrl, PhysicalModeController, type PhysicalStatus } from './physical/physical-mode-controller';
import { ProjectorModeHud } from './projector-mode-hud';
import { projectorRenderStyle } from './projector-render-style';
import { SandboxGpuScene } from './sandbox-gpu-scene';
import { MAX_STEPS_PER_FRAME, SandboxSession } from './sandbox-session';
import { stepFramesScripted } from './scripted-frame-stepper';

const CURSOR_IDLE_MS = 2500;

export async function startProjectorMode(gpu: GpuContext, root: HTMLElement, params: AppUrlParams): Promise<ProjectorModeApp> {
  const app = new ProjectorModeApp(gpu, root, params);
  await app.start();
  return app;
}

export class ProjectorModeApp {
  private readonly gpu: GpuContext;
  private readonly root: HTMLElement;
  private readonly appRoot: HTMLDivElement;
  private readonly stage: CanvasStage;
  private readonly scene: SandboxGpuScene;
  private readonly session: SandboxSession;
  private readonly physical: PhysicalModeController;
  private readonly hud: ProjectorModeHud;
  private readonly loop: FrameLoop;
  private readonly monitor: GpuErrorMonitor;
  private readonly cleanups: (() => void)[] = [];
  private status: PhysicalStatus | null = null;
  private timeSec = 0;
  private hudRefreshSec = 0;
  private cursorTimer = 0;
  private failed = false;

  constructor(gpu: GpuContext, root: HTMLElement, params: AppUrlParams) {
    const grid = DEFAULT_GRID;
    this.gpu = gpu;
    this.root = root;
    this.stage = new CanvasStage(grid, 'ls-projector-surface');
    const physicalUi = h('div', { class: 'ls-physical-ui' });
    this.hud = new ProjectorModeHud({
      calibrate: () => this.physical.openCalibration(),
      toggleFullscreen: () => toggleDocumentFullscreen(),
      exitToVirtual: () => window.location.assign(urlForMode('virtual')),
      toggleHud: () => this.hud.toggle(),
    });
    this.appRoot = h('div', { class: 'ls-app mode-projector' }, [this.stage.root, physicalUi, this.hud.root]);
    root.replaceChildren(this.appRoot);

    this.physical = new PhysicalModeController({
      grid,
      relayUrl: defaultRelayUrl(window.location),
      uiRoot: physicalUi,
      onStatus: (s) => this.onPhysicalStatus(s),
    });
    this.physical.attachProjectorSurface(this.stage.root);
    this.scene = new SandboxGpuScene(gpu, grid, configureCanvas(gpu, this.stage.canvas), projectorRenderStyle(this.physical, grid));
    // Real sand brings its own landscape: free play there is the blank box (no virtual springs on the sand), and
    // projector mode has no lava, so volcano levels fall back to it too.
    const picked = params.levelId ? getLevel(params.levelId) : BLANK_SANDBOX_LEVEL;
    const level = isFreePlay(picked) || picked.eruption ? BLANK_SANDBOX_LEVEL : picked;
    this.session = new SandboxSession(this.scene, level, { keepTerrain: true });
    this.loop = new FrameLoop((dt) => this.tick(dt), (err) => this.fail(err));
    this.monitor = new GpuErrorMonitor(gpu.device, (msg) => this.fail(new Error(msg)));
    this.installInput();
  }

  async start(): Promise<void> {
    this.physical.start();
    this.stage.syncSize();
    this.tick(1 / 60);
    await this.gpu.device.queue.onSubmittedWorkDone();
    if (this.failed) return;
    publishDebugApi({
      readWater: () => this.scene.sim.readWater(),
      readLava: () => Promise.reject(new Error('Projector mode has no lava')),
      readRock: () => Promise.reject(new Error('Projector mode has no lava')),
      getHeights: () => this.session.heights.slice(),
      stepFrames: (n, dtSec = 1 / 60, draw = true) =>
        stepFramesScripted(this.loop, this.gpu.device, n, dtSec, (dt, drawFrame) => this.frame(dt, Math.ceil(dt / this.session.simDt) + 1, drawFrame), draw),
      state: () => this.state(),
    });
    this.loop.start();
    markLiveSandReady();
  }

  private tick(dtReal: number): void {
    this.stage.syncSize();
    this.frame(dtReal, MAX_STEPS_PER_FRAME, true);
    this.hudRefreshSec -= dtReal;
    if (this.hudRefreshSec <= 0) {
      this.hudRefreshSec = 0.25;
      this.hud.setGame(this.gameText());
    }
  }

  /** Newest depth terrain (if any) -> sim -> draw; a frame without a new depth frame keeps the last terrain. */
  private frame(dt: number, maxSteps: number, draw: boolean): void {
    const polled = this.physical.poll();
    if (polled && polled.heights.length === this.session.heights.length) {
      this.session.heights.set(polled.heights);
      this.session.markTerrainDirty();
      this.session.setHandMask(polled.handMask);
    }
    this.timeSec += dt;
    this.scene.setStyle({ timeSec: this.timeSec, stormLevel: this.session.stormLevel });
    this.session.frame({ dtSim: dt, maxSteps, view: draw ? '2d' : null, camera: null });
  }

  private onPhysicalStatus(s: PhysicalStatus): void {
    const wasLive = (this.status?.connected ?? false) && (this.status?.sources ?? 0) > 0;
    this.status = s;
    this.hud.setStatus(s);
    // A lost phone must not leave its last hand mask raining forever.
    if (wasLive && !(s.connected && s.sources > 0)) this.session.setHandMask(null);
    // Status fires before the scene exists (constructor) and after calibration edits change the height range.
    if (this.scene) this.scene.setStyle(projectorRenderStyle(this.physical, this.session.grid));
  }

  private gameText(): string | null {
    const { game, level } = this.session;
    if (level.villages.length === 0) return null;
    const { saved, total } = game.summary();
    if (game.phase === 'ready') return `${level.name}: press Enter to start`;
    if (game.phase === 'running') return `${level.name} · ${formatClock(level.durationSec - game.elapsedSec)} · ${saved}/${total} villages dry`;
    return `${game.phase === 'won' ? 'Saved' : 'Flooded'}: ${saved}/${total} villages · R to retry`;
  }

  private installInput(): void {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.repeat || isTypingTarget(ev.target)) return;
      const key = ev.key.toLowerCase();
      if (key === 'h') this.hud.toggle();
      else if (key === 'c') this.physical.openCalibration();
      else if (key === 'f') toggleDocumentFullscreen();
      else if (key === 'enter' && !(ev.target instanceof HTMLButtonElement)) this.session.startGame();
      else if (key === 'r') this.session.loadLevel(this.session.level);
      else return;
      ev.preventDefault();
    };
    // Projected cursors land on the sand, so the pointer hides after a moment without movement.
    const onMove = (): void => {
      this.appRoot.classList.remove('is-cursor-idle');
      window.clearTimeout(this.cursorTimer);
      this.cursorTimer = window.setTimeout(() => this.appRoot.classList.add('is-cursor-idle'), CURSOR_IDLE_MS);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointermove', onMove);
    onMove();
    this.cleanups.push(() => window.removeEventListener('keydown', onKey), () => window.removeEventListener('pointermove', onMove));
  }

  private state(): Record<string, unknown> {
    const { game, level } = this.session;
    return {
      mode: 'projector',
      view: '2d',
      level: level.id,
      phase: game.phase,
      elapsedSec: game.elapsedSec,
      villages: game.villages.map((v) => ({ name: v.spec.name, state: v.state, floodedSec: v.floodedSec })),
      physical: this.status ?? this.physical.status,
      hudVisible: this.hud.visible,
      simSteps: this.session.totalSteps,
      fps: this.loop.fps,
      canvas: this.stage.pixelSize,
      gpuErrors: [...this.monitor.errors],
    };
  }

  private fail(err: unknown): void {
    if (this.failed) return;
    this.failed = true;
    const message = describeError(err);
    console.error('[livesand] fatal:', err);
    this.loop.stop();
    this.physical.stop();
    this.cleanups.forEach((fn) => fn());
    reportLiveSandError(message);
    showFatalErrorScreen(this.root, message);
  }
}
