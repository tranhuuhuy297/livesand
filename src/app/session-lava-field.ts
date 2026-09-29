// Lava emission for a sandbox session (eruption crater + lava brush, re-uploaded only when it changes) and whether
// any lava may still be moving, so frames without lava skip the lava steps entirely.
import type { GridSize } from '../core/types';
import type { LevelDefinition, WaterSourceSpec } from '../game/level-definitions';
import { buildEmissionField, type VillageFloodGame } from '../game/village-flood-game';
import { paintRainBrush } from '../input/sculpt-tools';

/** Lava brush output at the centre (world units/s per cell): a small brush builds a flow in a couple of seconds. */
export const LAVA_BRUSH_RATE = 1.2;
/** Stepped frames with no emission and no molten lava in the probe readback before lava steps stop. */
export const LAVA_IDLE_FRAMES = 30;

/** The level's crater as an emitting disc at the current eruption rate (null outside a running eruption). */
export function eruptionCrater(level: LevelDefinition, game: VillageFloodGame): WaterSourceSpec | null {
  if (!level.eruption || game.phase !== 'running') return null;
  return { u: level.eruption.u, v: level.eruption.v, radius: level.eruption.radius, rate: game.currentLavaRate() };
}

export class SessionLavaField {
  private readonly grid: GridSize;
  private readonly brush: Float32Array;
  private readonly field: Float32Array;
  private brushActive = false;
  private brushFrame = 0;
  private key = '';
  private emitting = false;
  private moving = false;
  private quietFrames = 0;

  constructor(grid: GridSize) {
    this.grid = grid;
    this.brush = new Float32Array(grid.width * grid.height);
    this.field = new Float32Array(grid.width * grid.height);
  }

  /** Lava is being emitted or has not been seen frozen yet. */
  get active(): boolean {
    return this.moving;
  }

  /** Lava follows the cursor like the rain brush: repainted every held frame, cleared on release. */
  paintBrush(cx: number, cy: number, radius: number): void {
    this.brush.fill(0);
    paintRainBrush(this.brush, this.grid, cx, cy, radius, LAVA_BRUSH_RATE);
    this.brushActive = true;
    this.brushFrame++;
  }

  clearBrush(): void {
    if (!this.brushActive) return;
    this.brush.fill(0);
    this.brushActive = false;
    this.brushFrame++;
  }

  /** New level: lava and rock were cleared on the GPU, so nothing is moving and the next field must upload. */
  reset(): void {
    this.clearBrush();
    this.key = '';
    this.emitting = false;
    this.moving = false;
    this.quietFrames = 0;
  }

  /** Rebuilds the emission when the crater rate or the brush changed; returns it to upload, or null. */
  update(levelVersion: number, crater: WaterSourceSpec | null): Float32Array | null {
    const rate = crater && Number.isFinite(crater.rate) && crater.rate > 0 ? crater.rate : 0;
    const key = `${levelVersion}|${rate}|${this.brushFrame}`;
    if (key === this.key) return null;
    this.key = key;
    this.emitting = rate > 0 || this.brushActive;
    if (this.emitting) this.moving = true;
    const craters = crater && rate > 0 ? [crater] : [];
    return buildEmissionField(this.grid, craters, 0, this.brushActive ? this.brush : null, null, 0, this.field);
  }

  /** After a frame: `maxLava` is the deepest molten lava in the latest readback (null while none has landed). */
  track(stepped: boolean, maxLava: number | null): void {
    if (this.emitting) {
      this.moving = true;
      this.quietFrames = 0;
      return;
    }
    if (!this.moving || !stepped || maxLava === null) return;
    this.quietFrames = maxLava > 0 ? 0 : this.quietFrames + 1;
    if (this.quietFrames >= LAVA_IDLE_FRAMES) this.moving = false;
  }
}
