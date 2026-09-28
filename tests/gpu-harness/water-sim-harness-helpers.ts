// Field builders, reductions, step runner, error scopes and a CPU probe reference for the water-sim harness.
import type { GridSize } from '../../src/core/types';
import type { WaterProbe } from '../../src/gpu/village-water-probe';
import type { WaterSimPipes } from '../../src/gpu/water-sim-pipes';

export function field(grid: GridSize, fn: (x: number, y: number) => number): Float32Array {
  const out = new Float32Array(grid.width * grid.height);
  for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) out[y * grid.width + x] = fn(x, y);
  return out;
}

export function disc(grid: GridSize, cx: number, cy: number, radius: number, value: number): Float32Array {
  return field(grid, (x, y) => ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius ? value : 0));
}

/** Smooth bumps plus a gentle tilt, so flow has to cross uneven ground. */
export function bumpyTerrain(grid: GridSize): Float32Array {
  return field(grid, (x, y) => 2 + 1.5 * Math.sin(x * 0.3) * Math.cos(y * 0.25) + 0.02 * x);
}

export function sum(a: Float32Array): number {
  let s = 0;
  for (const v of a) s += v;
  return s;
}

export function minOf(a: Float32Array): number {
  let m = Infinity;
  for (const v of a) m = Math.min(m, v);
  return m;
}

export function maxOf(a: Float32Array): number {
  let m = -Infinity;
  for (const v of a) m = Math.max(m, v);
  return m;
}

export function countNaN(a: Float32Array): number {
  let n = 0;
  for (const v of a) if (!Number.isFinite(v)) n++;
  return n;
}

export function centroidX(a: Float32Array, grid: GridSize): number {
  let mass = 0;
  let moment = 0;
  for (let i = 0; i < a.length; i++) {
    mass += a[i];
    moment += a[i] * (i % grid.width);
  }
  return mass > 0 ? moment / mass : NaN;
}

/** Submits `steps` sim steps in batches (keeps command buffers small) and waits for the GPU to finish. */
export async function runSteps(device: GPUDevice, sim: WaterSimPipes, steps: number, batch = 50): Promise<void> {
  for (let done = 0; done < steps; done += batch) {
    const encoder = device.createCommandEncoder();
    sim.encodeSteps(encoder, Math.min(batch, steps - done));
    device.queue.submit([encoder.finish()]);
  }
  await device.queue.onSubmittedWorkDone();
}

/** CPU mirror of the probe shader: integer cell coords, circle test, nearest cell always included. */
export function cpuProbeMax(water: Float32Array, grid: GridSize, p: WaterProbe): number {
  const r = Math.max(p.radius, 0);
  const x0 = Math.max(Math.floor(p.x - r), 0);
  const x1 = Math.min(Math.ceil(p.x + r), grid.width - 1);
  const y0 = Math.max(Math.floor(p.y - r), 0);
  const y1 = Math.min(Math.ceil(p.y + r), grid.height - 1);
  const nx = Math.floor(p.x + 0.5);
  const ny = Math.floor(p.y + 0.5);
  let m = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const inside = (x - p.x) ** 2 + (y - p.y) ** 2 <= r * r || (x === nx && y === ny);
      if (inside) m = Math.max(m, water[y * grid.width + x]);
    }
  }
  return m;
}

/** Runs `fn` inside validation + internal error scopes and attaches every GPU error seen meanwhile. */
export async function withErrorScopes<T extends object>(
  device: GPUDevice,
  uncaptured: string[],
  fn: () => Promise<T>,
): Promise<T & { errors: string[] }> {
  const uncapturedBefore = uncaptured.length;
  device.pushErrorScope('validation');
  device.pushErrorScope('internal');
  let result: T | undefined;
  let failure: unknown = null;
  try {
    result = await fn();
  } catch (err) {
    failure = err;
  }
  const internal = await device.popErrorScope();
  const validation = await device.popErrorScope();
  if (failure !== null || result === undefined) throw failure ?? new Error('scenario returned nothing');
  const errors = [validation, internal].flatMap((e) => (e ? [`${e.constructor.name}: ${e.message}`] : []));
  return { ...result, errors: errors.concat(uncaptured.slice(uncapturedBefore)) };
}
