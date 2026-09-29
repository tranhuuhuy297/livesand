// Lava + water rig lifecycle, coupled step runner and field reductions for the lava-sim harness scenarios.
import type { GridSize } from '../../src/core/types';
import { LavaSim, type LavaSimParams } from '../../src/gpu/lava-sim';
import { readStorageBufferF32 } from '../../src/gpu/lava-sim-readback';
import { WaterSimPipes, type WaterSimParams } from '../../src/gpu/water-sim-pipes';

/** Odd sizes exercise the partial-workgroup bounds checks. */
export const LAVA_HARNESS_GRID: GridSize = { width: 61, height: 45 };

export interface LavaRig {
  water: WaterSimPipes;
  lava: LavaSim;
}

export interface RigOptions {
  water?: Partial<WaterSimParams>;
  lava?: Partial<LavaSimParams>;
}

/** Fresh water + lava sims per scenario, always freed even when the scenario throws. */
export async function withRig<T>(device: GPUDevice, opts: RigOptions, fn: (rig: LavaRig) => Promise<T>): Promise<T> {
  const water = new WaterSimPipes(device, LAVA_HARNESS_GRID, { evaporationPerSec: 0, ...opts.water });
  let lava: LavaSim | null = null;
  try {
    lava = new LavaSim(device, water, opts.lava);
    return await fn({ water, lava });
  } finally {
    lava?.destroy();
    water.destroy();
  }
}

/**
 * Submits `steps` steps in batches like the app's frames: `chunk` lava steps, then (optionally) the same number of
 * water steps, so both sims see each other's latest fields. Waits for the GPU to finish.
 */
export async function runCoupled(device: GPUDevice, rig: LavaRig, steps: number, withWater: boolean, chunk = 4): Promise<void> {
  const batch = chunk * 12;
  for (let done = 0; done < steps; done += batch) {
    const encoder = device.createCommandEncoder();
    const end = Math.min(done + batch, steps);
    for (let s = done; s < end; s += chunk) {
      const n = Math.min(chunk, end - s);
      rig.lava.encodeSteps(encoder, n);
      if (withWater) rig.water.encodeSteps(encoder, n);
    }
    device.queue.submit([encoder.finish()]);
  }
  await device.queue.onSubmittedWorkDone();
}

export function readTerrain(device: GPUDevice, rig: LavaRig): Promise<Float32Array> {
  const { width, height } = rig.water.grid;
  return readStorageBufferF32(device, rig.water.buffers.terrain, width * height, 'lava-harness-read-terrain');
}

export function add(a: Float32Array, b: Float32Array): Float32Array {
  return a.map((v, i) => v + b[i]);
}

/** Largest x (column) holding more than `threshold`, or -1 when none does. */
export function frontX(a: Float32Array, grid: GridSize, threshold: number): number {
  let front = -1;
  for (let i = 0; i < a.length; i++) if (a[i] > threshold) front = Math.max(front, i % grid.width);
  return front;
}

/** Sum of `a` over cells whose column satisfies `pick`. */
export function sumColumns(a: Float32Array, grid: GridSize, pick: (x: number) => boolean): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) if (pick(i % grid.width)) s += a[i];
  return s;
}

/** Farthest distance from (cx, cy) of a cell holding more than `threshold`. */
export function extentFrom(a: Float32Array, grid: GridSize, cx: number, cy: number, threshold: number): number {
  let r = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] > threshold) r = Math.max(r, Math.hypot((i % grid.width) - cx, Math.floor(i / grid.width) - cy));
  }
  return r;
}

/** max |terrain - (base + rock + lava)| using the shader's f32 add order. */
export function composeMaxAbsDiff(terrain: Float32Array, base: Float32Array, rock: Float32Array, lava: Float32Array): number {
  let m = 0;
  for (let i = 0; i < terrain.length; i++) {
    m = Math.max(m, Math.abs(terrain[i] - Math.fround(Math.fround(base[i] + rock[i]) + lava[i])));
  }
  return m;
}
