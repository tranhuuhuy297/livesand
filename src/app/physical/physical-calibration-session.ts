// Decides which calibration drives the terrain (saved, rough fallback or live wizard draft) and runs the wizard.
import type { DepthFrame } from '../../core/depth-frame-protocol';
import type { GridSize } from '../../core/types';
import { loadCalibration, saveCalibration } from './calibration-storage';
import { CalibrationWizard } from './calibration-wizard';
import type { WizardHost } from './calibration-wizard-types';
import type { KeystoneSurface } from './keystone-surface';
import { identityKeystone, makeRoughCalibration, type PhysicalCalibration } from './physical-calibration-model';
import type { PhysicalTerrainPipeline } from './physical-terrain-pipeline';

export interface CalibrationSessionDeps {
  grid: GridSize;
  terrain: PhysicalTerrainPipeline;
  surface: KeystoneSurface;
  latestFrame(): { frame: DepthFrame; seq: number } | null;
  isLive(): boolean;
  /** Processes the newest frame if it has not been processed yet. */
  pumpTerrain(): void;
  /** Called after the wizard closed or the calibration changed, so the controller can refresh UI/status. */
  onChange(): void;
}

export class PhysicalCalibrationSession {
  private readonly deps: CalibrationSessionDeps;
  private readonly host: WizardHost;
  private savedCal: PhysicalCalibration | null = null;
  private wizard: CalibrationWizard | null = null;
  private rough = false;
  private declined = false;
  private wanted = false;
  private issue: string | null = null;

  constructor(deps: CalibrationSessionDeps) {
    this.deps = deps;
    this.host = {
      grid: deps.grid,
      keystoneSurface: deps.surface,
      latestFrame: () => deps.latestFrame(),
      isLive: () => deps.isLive(),
      latestTerrain: () => {
        deps.pumpTerrain();
        return deps.terrain.latest();
      },
      previewCalibration: (cal) => this.use(cal),
    };
  }

  get saved(): PhysicalCalibration | null {
    return this.savedCal;
  }

  get usingRough(): boolean {
    return this.rough;
  }

  get wizardStep(): number | null {
    return this.wizard ? this.wizard.stepIndex : null;
  }

  /** Last save/load problem worth telling the user about. */
  get problem(): string | null {
    return this.issue;
  }

  loadSaved(): void {
    const loaded = loadCalibration(this.deps.grid);
    if (loaded.ok) {
      this.savedCal = loaded.calibration;
      this.use(this.savedCal);
    } else if (!loaded.missing) {
      this.issue = 'the saved calibration was unusable and has been ignored';
      console.warn(`LiveSand physical mode: ${loaded.reason}`);
    }
  }

  requestWizard(): void {
    this.wanted = true;
    this.declined = false;
  }

  mismatch(frame: DepthFrame | null): string | null {
    const s = this.savedCal;
    if (!frame || !s || (frame.width === s.depthWidth && frame.height === s.depthHeight)) return null;
    return `Depth image changed from ${s.depthWidth}×${s.depthHeight} to ${frame.width}×${frame.height}; recalibrate`;
  }

  /** Opens the wizard when requested or needed (no/mismatched calibration), or restarts it on a new frame size. */
  update(frame: DepthFrame, layer: HTMLElement): void {
    if (this.wizard) {
      this.wizard.restartForFrameSize(frame.width, frame.height);
      return;
    }
    if (!this.wanted && (this.declined || (this.savedCal && !this.mismatch(frame)))) return;
    this.wanted = false;
    this.wizard = new CalibrationWizard({
      host: this.host,
      root: layer,
      frameWidth: frame.width,
      frameHeight: frame.height,
      initial: this.savedCal,
      canCancel: this.savedCal !== null && !this.mismatch(frame),
      onFinish: (cal) => this.finishWizard(cal),
      onClose: () => this.finishWizard(null),
    });
  }

  get wizardOpen(): boolean {
    return this.wizard !== null;
  }

  /** A rough calibration follows the depth image when its size changes (or once frames carry valid depth). */
  followFrame(frame: DepthFrame | null): void {
    const cal = this.deps.terrain.calibration;
    if (frame && this.rough && (!cal || cal.depthWidth !== frame.width || cal.depthHeight !== frame.height)) this.useRough(frame);
  }

  /** Makes `cal` the saved calibration (persisting it unless `persist` is false). */
  adopt(cal: PhysicalCalibration, persist: boolean): void {
    this.closeWizard();
    this.issue = null;
    if (persist) {
      try {
        saveCalibration(cal);
      } catch (err) {
        this.issue = (err as Error).message;
      }
    }
    this.savedCal = cal;
    this.rough = this.declined = false;
    this.use(cal);
    this.deps.onChange();
  }

  use(cal: PhysicalCalibration | null): void {
    this.deps.terrain.setCalibration(cal);
    if (cal) this.deps.surface.setKeystone(cal.keystone);
  }

  reset(): void {
    this.closeWizard();
    this.rough = this.declined = this.wanted = false;
  }

  private closeWizard(): void {
    this.wizard?.close();
    this.wizard = null;
    this.wanted = false;
  }

  private useRough(frame: DepthFrame): void {
    this.rough = true;
    this.use(makeRoughCalibration(this.deps.grid, frame, this.savedCal?.keystone ?? identityKeystone()));
  }

  /** Cancel returns to the saved calibration; skipping without one falls back to a rough automatic calibration. */
  private finishWizard(cal: PhysicalCalibration | null): void {
    if (cal) return this.adopt(cal, true);
    this.closeWizard();
    const frame = this.deps.latestFrame()?.frame ?? null;
    if (this.savedCal && !this.mismatch(frame)) {
      this.use(this.savedCal);
    } else {
      this.declined = true;
      if (frame) this.useRough(frame);
      else this.use(null);
    }
    this.deps.onChange();
  }
}
