// Physical (real sandbox) mode: relay connection, pairing UI, calibration wizard, depth -> terrain, projector keystone.
import { assertValidGrid } from '../../core/depth-calibration';
import type { GridSize } from '../../core/types';
import { DepthStreamClient } from './depth-stream-client';
import { el } from './dom-builder';
import { KeystoneSurface } from './keystone-surface';
import { PairingPanel } from './pairing-panel';
import { defaultHeightRange, heightRangeOf, type HeightRange, type PhysicalCalibration } from './physical-calibration-model';
import { PhysicalCalibrationSession } from './physical-calibration-session';
import { describePhysicalStatus, sameStatus, type PhysicalStatus } from './physical-status';
import { PhysicalTerrainPipeline, type PhysicalTerrain } from './physical-terrain-pipeline';
import { ensurePhysicalStyles } from './physical-ui-styles';
import { relayDisplayHost } from './relay-url-utils';

export { defaultRelayUrl } from './relay-url-utils';
export type { PhysicalStatus } from './physical-status';
export type { PhysicalTerrain } from './physical-terrain-pipeline';
export type { HeightRange, PhysicalCalibration } from './physical-calibration-model';

export interface PhysicalModeOptions {
  grid: GridSize;
  relayUrl: string;
  uiRoot: HTMLElement;
  onStatus?: (s: PhysicalStatus) => void;
}

declare global {
  interface Window {
    /** The running controller, for e2e tests and debugging from the console. */
    __livesandPhysical?: PhysicalModeController;
  }
}

const STATUS_TICK_MS = 500;
// A source that sent nothing for this long counts as gone (the phone slept or lost Wi-Fi).
const LIVE_TIMEOUT_MS = 2500;
// Brief Wi-Fi dropouts must not cover a running projection with the pairing panel.
const PAIRING_GRACE_MS = 6000;

export class PhysicalModeController {
  readonly relayUrl: string;
  private readonly grid: GridSize;
  private readonly uiRoot: HTMLElement;
  private readonly onStatus: ((s: PhysicalStatus) => void) | undefined;
  private readonly client: DepthStreamClient;
  private readonly terrain: PhysicalTerrainPipeline;
  private readonly surface = new KeystoneSurface();
  private readonly session: PhysicalCalibrationSession;
  private surfaceEl: HTMLElement | null = null;
  private layer: HTMLElement | null = null;
  private pairing: PairingPanel | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private current: PhysicalStatus = { connected: false, sources: 0, fps: 0, calibrated: false, message: 'Physical mode is not started' };

  constructor(opts: PhysicalModeOptions) {
    assertValidGrid(opts.grid);
    this.grid = { width: opts.grid.width, height: opts.grid.height };
    this.relayUrl = opts.relayUrl;
    this.uiRoot = opts.uiRoot;
    this.onStatus = opts.onStatus;
    this.client = new DepthStreamClient({ url: opts.relayUrl, onChange: () => this.refresh() });
    this.terrain = new PhysicalTerrainPipeline(this.grid);
    this.session = new PhysicalCalibrationSession({
      grid: this.grid,
      terrain: this.terrain,
      surface: this.surface,
      onChange: () => this.refresh(),
      latestFrame: () => {
        const frame = this.client.latestFrame;
        return frame ? { frame, seq: this.client.frameSeq } : null;
      },
      isLive: () => this.isLive(),
      pumpTerrain: () => this.pumpTerrain(),
    });
  }

  get status(): PhysicalStatus {
    return { ...this.current };
  }

  /** Saved calibration (null until the wizard was completed once in this browser). */
  get calibration(): PhysicalCalibration | null {
    return this.session.saved;
  }

  /** Height range of the terrain poll() returns; renderers should span their colour map over it. */
  get heightRange(): HeightRange {
    const cal = this.terrain.calibration ?? this.session.saved;
    return cal ? heightRangeOf(cal) : defaultHeightRange(this.grid);
  }

  /** 0-based wizard step while calibrating, else null. */
  get wizardStep(): number | null {
    return this.session.wizardStep;
  }

  /** Newest processed terrain without consuming it (poll() still returns it once). */
  get lastTerrain(): PhysicalTerrain | null {
    return this.terrain.latest();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    ensurePhysicalStyles();
    this.layer = el('div', 'lsp-phys');
    this.uiRoot.append(this.layer);
    this.pairing = new PairingPanel(this.layer, this.relayUrl);
    if (this.surfaceEl) this.surface.attach(this.surfaceEl);
    this.session.loadSaved();
    this.client.start();
    this.timer = setInterval(() => this.refresh(), STATUS_TICK_MS);
    window.__livesandPhysical = this;
    this.refresh();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.client.stop();
    this.session.reset();
    this.pairing?.hide();
    this.pairing = null;
    this.layer?.remove();
    this.layer = null;
    this.surface.detach();
    this.terrain.reset();
    if (window.__livesandPhysical === this) delete window.__livesandPhysical;
    this.current = { connected: false, sources: 0, fps: 0, calibrated: this.session.saved !== null, message: 'Physical mode stopped' };
    this.onStatus?.({ ...this.current });
  }

  /** Newest processed terrain since the last poll (at most one frame processed per call), or null. */
  poll(): PhysicalTerrain | null {
    if (!this.started) return null;
    this.pumpTerrain();
    return this.terrain.take();
  }

  /** Opens the wizard now, or as soon as depth frames arrive. */
  openCalibration(): void {
    if (!this.started) return;
    this.session.requestWizard();
    this.refresh();
  }

  attachProjectorSurface(el: HTMLElement): void {
    this.surfaceEl = el;
    if (this.started) this.surface.attach(el);
  }

  /** Uses a complete calibration directly (presets, tests); persists it unless `persist` is false. */
  applyCalibration(cal: PhysicalCalibration, persist = true): void {
    this.session.adopt(cal, persist);
  }

  private pumpTerrain(): void {
    const frame = this.client.latestFrame;
    this.session.followFrame(frame);
    this.terrain.pump(frame, this.client.frameSeq);
  }

  private isLive(): boolean {
    return this.client.latestFrame !== null && performance.now() - this.client.lastFrameAtMs < LIVE_TIMEOUT_MS;
  }

  /** Re-evaluates what to show (pairing / wizard) and publishes the status when it changed. */
  private refresh(): void {
    const layer = this.layer;
    if (!this.started || !layer) return;
    const frame = this.client.latestFrame;
    const live = this.isLive();
    if (live && frame) this.session.update(frame, layer);
    const silentMs = performance.now() - this.client.lastFrameAtMs;
    if (this.session.wizardOpen || (frame !== null && silentMs < PAIRING_GRACE_MS)) this.pairing?.hide();
    else this.pairing?.show();
    const { client, session } = this;
    const mismatch = session.mismatch(frame);
    const rough = session.usingRough;
    const status = describePhysicalStatus({
      connection: client.state, relayHost: relayDisplayHost(this.relayUrl), retryInMs: client.retryInMs,
      lastError: client.lastError, sources: client.sources, fps: client.fps(), live,
      frameSize: frame ? { width: frame.width, height: frame.height } : null,
      wizardOpen: session.wizardOpen, mismatch: rough ? null : mismatch,
      calibrated: session.saved !== null && !mismatch && !rough, usingRough: rough,
      hasCalibration: this.terrain.calibration !== null, problem: session.problem ?? this.terrain.error,
    });
    this.pairing?.update(status);
    if (sameStatus(status, this.current)) return;
    this.current = status;
    this.onStatus?.({ ...status });
  }
}
