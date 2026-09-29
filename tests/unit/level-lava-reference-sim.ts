// CPU replica of the GPU lava model (same flux/depth/cooling passes, yield stress, edge rules, freeze rule and quench in
// the painted sea) without simulated water, used to prove the volcano level: idle play burns the village, a wall or
// trench saves it.
import type { EdgeFlags, GridSize } from '../../src/core/types';
import { DEFAULT_LAVA_SIM_PARAMS, LAVA_FREEZE_DEPTH, LAVA_NO_SEA, LAVA_YIELD_STRENGTH } from '../../src/gpu/lava-sim-params';
import type { WaterProbe } from '../../src/gpu/village-water-probe';

export interface ReferenceLavaParams {
  gravity: number;
  damping: number;
  dt: number;
  coolingPerSec: number;
  quenchPerSec: number;
  seaLevel: number;
  openEdges: EdgeFlags;
}

export const REFERENCE_LAVA_DEFAULTS: Omit<ReferenceLavaParams, 'openEdges'> = {
  gravity: DEFAULT_LAVA_SIM_PARAMS.gravity,
  damping: DEFAULT_LAVA_SIM_PARAMS.damping,
  dt: DEFAULT_LAVA_SIM_PARAMS.dt,
  coolingPerSec: DEFAULT_LAVA_SIM_PARAMS.coolingPerSec,
  quenchPerSec: DEFAULT_LAVA_SIM_PARAMS.quenchPerSec,
  seaLevel: LAVA_NO_SEA,
};

export class ReferenceLavaSim {
  readonly lava: Float32Array;
  readonly rock: Float32Array;
  readonly flux: Float32Array;
  drained = 0;

  /** `base` is read live every step, so sculpting it between steps behaves like uploadBaseTerrain. */
  constructor(
    readonly grid: GridSize,
    readonly base: Float32Array,
    readonly params: ReferenceLavaParams,
  ) {
    const n = grid.width * grid.height;
    if (base.length !== n) throw new RangeError('terrain size mismatch');
    this.lava = new Float32Array(n);
    this.rock = new Float32Array(n);
    this.flux = new Float32Array(n * 4);
  }

  step(emission: Float32Array): void {
    // The GPU tests the sea against the ground composed after the previous frame (one step per frame here).
    const wet = this.seaContact();
    this.fluxPass();
    this.depthPass(emission);
    this.coolPass(wet);
  }

  /** Max lava depth over the probe circle plus its nearest cell, exactly like VillageWaterProbe. */
  maxDepth(probe: WaterProbe): number {
    const { width, height } = this.grid;
    const r = Math.max(0, probe.radius);
    const nx = Math.floor(probe.x + 0.5);
    const ny = Math.floor(probe.y + 0.5);
    let m = 0;
    for (let y = Math.max(0, Math.floor(probe.y - r)); y <= Math.min(height - 1, Math.ceil(probe.y + r)); y++) {
      for (let x = Math.max(0, Math.floor(probe.x - r)); x <= Math.min(width - 1, Math.ceil(probe.x + r)); x++) {
        const dx = x - probe.x;
        const dy = y - probe.y;
        if (dx * dx + dy * dy <= r * r || (x === nx && y === ny)) m = Math.max(m, this.lava[y * width + x]);
      }
    }
    return m;
  }

  private head(i: number): number {
    return this.base[i] + this.rock[i] + this.lava[i];
  }

  private fluxPass(): void {
    const { width: w, height: h } = this.grid;
    const { dt, gravity, damping, openEdges } = this.params;
    const f = this.flux;
    const pipe = (prev: number, dh: number, yieldHead: number) => Math.max(0, damping * prev + dt * gravity * (dh - yieldHead));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const j = i * 4;
        const d = this.lava[i];
        if (d <= 0) {
          f[j] = f[j + 1] = f[j + 2] = f[j + 3] = 0;
          continue;
        }
        const hc = this.head(i);
        const yh = LAVA_YIELD_STRENGTH / Math.max(d, 1e-6);
        let l = 0;
        let r = 0;
        let n = 0;
        let s = 0;
        if (x > 0) l = pipe(f[j], hc - this.head(i - 1), yh);
        else if (openEdges.west) l = pipe(f[j], d, yh);
        if (x + 1 < w) r = pipe(f[j + 1], hc - this.head(i + 1), yh);
        else if (openEdges.east) r = pipe(f[j + 1], d, yh);
        if (y > 0) n = pipe(f[j + 2], hc - this.head(i - w), yh);
        else if (openEdges.north) n = pipe(f[j + 2], d, yh);
        if (y + 1 < h) s = pipe(f[j + 3], hc - this.head(i + w), yh);
        else if (openEdges.south) s = pipe(f[j + 3], d, yh);
        const total = l + r + n + s;
        const k = total * dt > d ? d / (total * dt) : 1;
        f[j] = l * k;
        f[j + 1] = r * k;
        f[j + 2] = n * k;
        f[j + 3] = s * k;
      }
    }
  }

  private depthPass(emission: Float32Array): void {
    const { width: w, height: h } = this.grid;
    const { dt } = this.params;
    const f = this.flux;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const j = i * 4;
        let inflow = 0;
        if (x > 0) inflow += f[(i - 1) * 4 + 1];
        if (x + 1 < w) inflow += f[(i + 1) * 4];
        if (y > 0) inflow += f[(i - w) * 4 + 3];
        if (y + 1 < h) inflow += f[(i + w) * 4 + 2];
        const outflow = f[j] + f[j + 1] + f[j + 2] + f[j + 3];
        if (x === 0) this.drained += f[j] * dt;
        if (x === w - 1) this.drained += f[j + 1] * dt;
        if (y === 0) this.drained += f[j + 2] * dt;
        if (y === h - 1) this.drained += f[j + 3] * dt;
        this.lava[i] = Math.max(this.lava[i] + dt * (inflow - outflow + emission[i]), 0);
      }
    }
  }

  /** Cells in or next to the painted sea (ground below sea level): the GPU's wetAt without simulated water. */
  private seaContact(): Uint8Array {
    const { width: w, height: h } = this.grid;
    const sea = this.params.seaLevel;
    const inSea = (i: number) => this.base[i] + this.rock[i] + this.lava[i] < sea;
    const wet = new Uint8Array(this.lava.length);
    for (let i = 0; i < wet.length; i++) {
      const x = i % w;
      const y = (i - x) / w;
      wet[i] = Number(inSea(i) || (x > 0 && inSea(i - 1)) || (x + 1 < w && inSea(i + 1)) || (y > 0 && inSea(i - w)) || (y + 1 < h && inSea(i + w)));
    }
    return wet;
  }

  private coolPass(wet: Uint8Array): void {
    const { coolingPerSec, quenchPerSec, dt } = this.params;
    for (let i = 0; i < this.lava.length; i++) {
      const d = this.lava[i];
      if (d <= 0) continue;
      const rate = coolingPerSec + (wet[i] ? quenchPerSec : 0);
      let solid = d * Math.min(1, rate * dt);
      let rest = d - solid;
      if (rate > 0 && rest < LAVA_FREEZE_DEPTH) {
        solid = d;
        rest = 0;
      }
      this.lava[i] = rest;
      this.rock[i] += solid;
    }
  }
}
