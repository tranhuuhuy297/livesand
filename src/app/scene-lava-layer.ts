// Lava for a sandbox scene: LavaSim on top of the water sim, plus probes reading lava depth at each village, in a wider
// ring around it (the "Lava close" warning), and the deepest lava anywhere (so lava steps can stop once all is frozen).
import type { GridSize } from '../core/types';
import { LavaSim, type LavaSimParams } from '../gpu/lava-sim';
import { VillageWaterProbe, type WaterProbe } from '../gpu/village-water-probe';
import type { WaterSimPipes } from '../gpu/water-sim-pipes';
import type { LavaSource } from '../render/lava-source-binding';
import { MAX_VILLAGES } from '../render/render-frame-uniforms';

/** Latest lava probe readback: max molten depth per village, within NEAR_RING_SCALE village radii, and over the grid. */
export interface LavaReading {
  villages: Float32Array;
  near: Float32Array;
  max: number;
}

/** The warning ring reaches this many village radii (plus a few cells, so small villages still get warned in time). */
export const NEAR_RING_SCALE = 2.5;
const NEAR_RING_EXTRA_CELLS = 4;

export class SceneLavaLayer {
  readonly sim: LavaSim;
  private readonly grid: GridSize;
  private readonly probe: VillageWaterProbe;
  private villageCount = 0;
  // The water sim only sees new ground after a compose pass, so uploads schedule one.
  private composePending = true;

  constructor(device: GPUDevice, water: WaterSimPipes) {
    this.grid = water.grid;
    this.sim = new LavaSim(device, water);
    // The probe shader reads its field through the `water` slot; here that slot is the lava depth buffer.
    this.probe = new VillageWaterProbe(device, { grid: water.grid, buffers: { water: this.sim.buffers.lava } }, 2 * MAX_VILLAGES + 1);
    this.setVillageProbes([]);
  }

  get source(): LavaSource {
    return { lava: this.sim.buffers.lava, rock: this.sim.buffers.rock, emission: this.sim.buffers.lavaEmission };
  }

  setParams(patch: Partial<LavaSimParams>): void {
    this.sim.setParams(patch);
  }

  uploadBaseTerrain(heights: Float32Array): void {
    this.sim.uploadBaseTerrain(heights);
    this.composePending = true;
  }

  uploadEmission(ratePerCell: Float32Array): void {
    this.sim.uploadLavaEmission(ratePerCell);
  }

  /** Village circles, then their wider warning rings, then one circle covering the whole grid for the global maximum. */
  setVillageProbes(probes: readonly WaterProbe[]): void {
    const { width, height } = this.grid;
    const villages = probes.slice(0, MAX_VILLAGES);
    const near = villages.map((p) => ({ ...p, radius: p.radius * NEAR_RING_SCALE + NEAR_RING_EXTRA_CELLS }));
    const whole: WaterProbe = { x: (width - 1) / 2, y: (height - 1) / 2, radius: Math.hypot(width, height) / 2 + 1 };
    this.probe.setProbes([...villages, ...near, whole]);
    this.villageCount = villages.length;
  }

  /** `steps` lava steps, then the base + rock + lava compose; nothing at all when idle and the ground is unchanged. */
  encode(encoder: GPUCommandEncoder, steps: number): void {
    if (steps <= 0 && !this.composePending) return;
    this.sim.encodeSteps(encoder, Math.max(0, steps));
    this.composePending = false;
  }

  encodeProbe(encoder: GPUCommandEncoder): void {
    this.probe.encode(encoder);
  }

  requestReadback(): void {
    this.probe.requestReadback();
  }

  reading(): LavaReading | null {
    const values = this.probe.latest();
    const n = this.villageCount;
    if (!values || values.length < 2 * n + 1) return null;
    return { villages: values.subarray(0, n), near: values.subarray(n, 2 * n), max: values[2 * n] };
  }

  /** Zeroes lava and rock; the water terrain is recomposed from the base right away. */
  clear(): void {
    this.sim.clear();
  }

  destroy(): void {
    this.probe.destroy();
    this.sim.destroy();
  }
}
