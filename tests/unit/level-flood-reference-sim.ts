// CPU replica of the GPU virtual-pipes water model (same pass order, edge rules and probe cell selection),
// used to prove level hydrology: idle play floods villages, the intended earthworks save them.
import type { EdgeFlags, GridSize } from '../../src/core/types';
import type { WaterProbe } from '../../src/gpu/village-water-probe';

export interface ReferenceSimParams {
  gravity: number;
  damping: number;
  evaporationPerSec: number;
  dt: number;
  openEdges: EdgeFlags;
}

export const REFERENCE_SIM_DEFAULTS: Omit<ReferenceSimParams, 'openEdges'> = {
  gravity: 9.81,
  damping: 0.995,
  evaporationPerSec: 0.01,
  dt: 0.05,
};

export class ReferenceWaterSim {
  readonly water: Float32Array;
  readonly flux: Float32Array;
  drained = 0;

  constructor(
    readonly grid: GridSize,
    readonly terrain: Float32Array,
    readonly params: ReferenceSimParams,
  ) {
    const n = grid.width * grid.height;
    if (terrain.length !== n) throw new RangeError('terrain size mismatch');
    this.water = new Float32Array(n);
    this.flux = new Float32Array(n * 4);
  }

  step(emission: Float32Array): void {
    this.fluxPass();
    this.depthPass(emission);
  }

  /** Max depth over cells within `radius` of (x,y) plus the nearest cell, exactly like VillageWaterProbe. */
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
        if (dx * dx + dy * dy <= r * r || (x === nx && y === ny)) m = Math.max(m, this.water[y * width + x]);
      }
    }
    return m;
  }

  private fluxPass(): void {
    const { width: w, height: h } = this.grid;
    const { dt, gravity, damping, openEdges } = this.params;
    const t = this.terrain;
    const d = this.water;
    const f = this.flux;
    const pipe = (prev: number, dh: number) => Math.max(0, damping * prev + dt * gravity * dh);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const depth = d[i];
        const hc = t[i] + depth;
        const j = i * 4;
        let l = 0;
        let r = 0;
        let n = 0;
        let s = 0;
        if (x > 0) l = pipe(f[j], hc - t[i - 1] - d[i - 1]);
        else if (openEdges.west) l = pipe(f[j], depth);
        if (x + 1 < w) r = pipe(f[j + 1], hc - t[i + 1] - d[i + 1]);
        else if (openEdges.east) r = pipe(f[j + 1], depth);
        if (y > 0) n = pipe(f[j + 2], hc - t[i - w] - d[i - w]);
        else if (openEdges.north) n = pipe(f[j + 2], depth);
        if (y + 1 < h) s = pipe(f[j + 3], hc - t[i + w] - d[i + w]);
        else if (openEdges.south) s = pipe(f[j + 3], depth);
        const total = l + r + n + s;
        const k = total * dt > depth ? depth / (total * dt) : 1;
        f[j] = l * k;
        f[j + 1] = r * k;
        f[j + 2] = n * k;
        f[j + 3] = s * k;
      }
    }
  }

  private depthPass(emission: Float32Array): void {
    const { width: w, height: h } = this.grid;
    const { dt, evaporationPerSec } = this.params;
    const f = this.flux;
    const d = this.water;
    const keep = Math.max(0, 1 - evaporationPerSec * dt);
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
        d[i] = Math.max(0, (d[i] + dt * (inflow - outflow + emission[i])) * keep);
      }
    }
  }
}
