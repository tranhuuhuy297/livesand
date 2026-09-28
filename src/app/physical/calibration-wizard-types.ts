// Shared shapes for the calibration wizard shell and its steps.
import type { DepthFrame } from '../../core/depth-frame-protocol';
import type { GridSize, Quad, Vec2 } from '../../core/types';
import type { KeystoneSurface } from './keystone-surface';
import type { PhysicalCalibration } from './physical-calibration-model';

/** What the wizard needs from the controller. */
export interface WizardHost {
  readonly grid: GridSize;
  readonly keystoneSurface: KeystoneSurface;
  latestFrame(): { frame: DepthFrame; seq: number } | null;
  /** True while depth frames keep arriving. */
  isLive(): boolean;
  /** Newest processed terrain (processing the newest frame if needed). */
  latestTerrain(): { heights: Float32Array; handMask: Uint8Array } | null;
  /** Makes an in-progress calibration live so terrain and projector update while the user tunes it. */
  previewCalibration(cal: PhysicalCalibration): void;
}

export interface ReferenceStats {
  frames: number;
  meanMeters: number;
  spreadMeters: number;
  validFraction: number;
}

/** Work-in-progress calibration edited by the steps. */
export interface WizardDraft {
  depthWidth: number;
  depthHeight: number;
  roiCorners: (Vec2 | null)[];
  referenceDepth: Float32Array | null;
  referencePlaneMeters: number | null;
  referenceStats: ReferenceStats | null;
  boxWidthCm: number;
  digCm: number;
  pileCm: number;
  keystone: Quad;
}

export type NoticeTone = 'info' | 'warn' | 'error';

export interface WizardStepContext {
  readonly host: WizardHost;
  readonly draft: WizardDraft;
  /** Full-viewport layer for overlays that must sit outside the wizard card (keystone handles). */
  readonly layer: HTMLElement;
  /** Re-evaluates navigation buttons after the step's state changed. */
  refresh(): void;
  notify(message: string | null, tone?: NoticeTone): void;
  /** Complete calibration from the draft, or null while corners or the flat-sand reference are missing. */
  buildCalibration(): PhysicalCalibration | null;
  /** Pushes the draft live (no-op while incomplete). */
  previewDraft(): void;
}

export interface WizardStep {
  readonly title: string;
  readonly short: string;
  /** Compact steps dock a small card and leave the screen free (projector alignment). */
  readonly compact?: boolean;
  mount(body: HTMLElement): void;
  unmount(): void;
  /** Called every animation frame while mounted. */
  tick(): void;
  canAdvance(): boolean;
  nextLabel?(): string;
}
