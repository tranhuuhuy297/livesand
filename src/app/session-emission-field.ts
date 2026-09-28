// Emission bookkeeping for a sandbox session: rain brush, hand mask and springs, re-uploaded only when they change.
import type { GridSize } from '../core/types';
import type { WaterSourceSpec } from '../game/level-definitions';
import { buildEmissionField } from '../game/village-flood-game';
import { paintRainBrush } from '../input/sculpt-tools';

/** Rain brush and hand rain intensity at the centre (world units/s per cell). */
export const BRUSH_RAIN_RATE = 0.4;
export const HAND_RAIN_RATE = 0.5;

export class SessionEmissionField {
  private readonly grid: GridSize;
  private readonly brushRain: Float32Array;
  private readonly field: Float32Array;
  private handMask: Uint8Array | null = null;
  private handVersion = 0;
  private brushActive = false;
  private brushFrame = 0;
  private key = '';

  constructor(grid: GridSize) {
    this.grid = grid;
    this.brushRain = new Float32Array(grid.width * grid.height);
    this.field = new Float32Array(grid.width * grid.height);
  }

  setHandMask(mask: Uint8Array | null): void {
    this.handMask = mask && mask.length === this.field.length ? mask : null;
    this.handVersion++;
  }

  /** Rain follows the cursor: the field is repainted every frame the brush is held and cleared when released. */
  paintBrush(cx: number, cy: number, radius: number): void {
    this.brushRain.fill(0);
    paintRainBrush(this.brushRain, this.grid, cx, cy, radius, BRUSH_RAIN_RATE);
    this.brushActive = true;
    this.brushFrame++;
  }

  clearBrush(): void {
    if (!this.brushActive) return;
    this.brushRain.fill(0);
    this.brushActive = false;
    this.brushFrame++;
  }

  /** Rebuilds the field when any input changed; returns it (to upload) or null when nothing changed. */
  update(levelVersion: number, sources: WaterSourceSpec[], rain: number): Float32Array | null {
    const key = `${levelVersion}|${rain}|${this.brushFrame}|${this.handVersion}`;
    if (key === this.key) return null;
    this.key = key;
    const brush = this.brushActive ? this.brushRain : null;
    return buildEmissionField(this.grid, sources, rain, brush, this.handMask, HAND_RAIN_RATE, this.field);
  }
}
