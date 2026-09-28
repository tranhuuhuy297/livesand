// Newest-frame-only depth -> terrain processing with a swappable calibration (saved, rough, or a live wizard draft).
import type { DepthFrame } from '../../core/depth-frame-protocol';
import { DepthTerrainProcessor } from '../../core/depth-terrain-processor';
import type { GridSize } from '../../core/types';
import { toDepthCalibration, type PhysicalCalibration } from './physical-calibration-model';

export interface PhysicalTerrain {
  heights: Float32Array;
  handMask: Uint8Array;
  /** True when heights moved since the previously returned result (hand mask may change regardless). */
  changed: boolean;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class PhysicalTerrainPipeline {
  private readonly grid: GridSize;
  private processor: DepthTerrainProcessor | null = null;
  private cal: PhysicalCalibration | null = null;
  private processedSeq = -1;
  private resultSeq = -1;
  private takenSeq = -1;
  private last: PhysicalTerrain | null = null;
  private pendingChanged = false;
  private lastError: string | null = null;

  constructor(grid: GridSize) {
    this.grid = { width: grid.width, height: grid.height };
  }

  get calibration(): PhysicalCalibration | null {
    return this.cal;
  }

  get error(): string | null {
    return this.lastError;
  }

  /** Swaps the calibration; heights re-seed from the next frame. Invalid calibrations are rejected (error set). */
  setCalibration(cal: PhysicalCalibration | null): void {
    this.lastError = null;
    this.cal = cal;
    if (!cal) {
      this.processor = null;
      return;
    }
    try {
      const depthCal = toDepthCalibration(cal);
      if (this.processor) this.processor.setCalibration(depthCal);
      else this.processor = new DepthTerrainProcessor(this.grid, depthCal);
    } catch (err) {
      this.lastError = `Calibration rejected: ${messageOf(err)}`;
      this.processor = null;
      this.cal = null;
    }
  }

  /** Processes `frame` unless `seq` was already handled; frames of another size than the calibration are skipped. */
  pump(frame: DepthFrame | null, seq: number): void {
    if (!frame || seq === this.processedSeq) return;
    this.processedSeq = seq;
    const { processor, cal } = this;
    if (!processor || !cal || frame.width !== cal.depthWidth || frame.height !== cal.depthHeight) return;
    try {
      const r = processor.process(frame);
      this.last = { heights: r.heights, handMask: r.handMask, changed: r.changed };
      this.pendingChanged ||= r.changed;
      this.resultSeq = seq;
      this.lastError = null;
    } catch (err) {
      this.lastError = `Depth processing failed: ${messageOf(err)}`;
    }
  }

  /** Newest result, whether or not it was taken. */
  latest(): PhysicalTerrain | null {
    return this.last;
  }

  /** Newest result not yet taken; `changed` covers every frame processed since the previous take. */
  take(): PhysicalTerrain | null {
    const last = this.last;
    if (!last || this.resultSeq === this.takenSeq) return null;
    this.takenSeq = this.resultSeq;
    const changed = this.pendingChanged;
    this.pendingChanged = false;
    return { heights: last.heights, handMask: last.handMask, changed };
  }

  reset(): void {
    this.processor = null;
    this.cal = null;
    this.last = null;
    this.pendingChanged = false;
    this.lastError = null;
    this.processedSeq = this.resultSeq = this.takenSeq = -1;
  }
}
