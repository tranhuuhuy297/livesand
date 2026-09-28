// VillageWaterProbe scenario: GPU max depths vs a CPU reference, plus the non-stalling readback rules.
import { VillageWaterProbe, type WaterProbe } from '../../src/gpu/village-water-probe';
import type { WaterSimPipes } from '../../src/gpu/water-sim-pipes';
import type { ProbeResult } from './water-sim-harness-api';
import * as H from './water-sim-harness-helpers';

// Centres on a 0.25 lattice and radii whose squares sit far from multiples of 1/16, so f32 (GPU) and f64 (CPU)
// circle tests agree exactly. Covers corners, partial/total out-of-grid and a sub-cell radius.
const PROBES_A: WaterProbe[] = [
  { x: 10, y: 10, radius: 4.6 },
  { x: 30.25, y: 22.75, radius: 7.4 },
  { x: 0, y: 0, radius: 3.3 },
  { x: 60, y: 44, radius: 5.2 },
  { x: -3, y: 20, radius: 4.6 },
  { x: 20.25, y: 30.5, radius: 0.2 },
  { x: 100, y: 100, radius: 2.3 },
  { x: 45.5, y: 12.25, radius: 12.3 },
];
const PROBES_B: WaterProbe[] = [
  { x: 5.5, y: 40.25, radius: 6.1 },
  { x: 33, y: 5, radius: 2.6 },
];

async function waitForLatest(probe: VillageWaterProbe, timeoutMs = 10_000): Promise<Float32Array> {
  const start = performance.now();
  for (;;) {
    const values = probe.latest();
    if (values) return values;
    if (performance.now() - start > timeoutMs) throw new Error('probe readback timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return Infinity;
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

export async function runProbeScenario(device: GPUDevice, sim: WaterSimPipes): Promise<ProbeResult> {
  const grid = sim.grid;
  // Deterministic pseudo-random depths with a few tall spikes so every probe has a distinct maximum.
  let seed = 12345;
  const rand = (): number => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  sim.uploadTerrain(H.bumpyTerrain(grid));
  sim.uploadWater(H.field(grid, () => (rand() < 0.03 ? 5 + rand() * 5 : rand() * 3)));
  await H.runSteps(device, sim, 5);
  const water = await sim.readWater();

  const probe = new VillageWaterProbe(device, sim, 16);
  try {
    probe.setProbes(PROBES_A);
    let encoder = device.createCommandEncoder();
    probe.encode(encoder);
    device.queue.submit([encoder.finish()]);
    probe.requestReadback();
    // While mapping, encode must be a no-op: a copy into the mapped staging buffer would fail submit validation.
    encoder = device.createCommandEncoder();
    probe.encode(encoder);
    device.queue.submit([encoder.finish()]);
    const gpuA = Array.from(await waitForLatest(probe));
    const cpuA = PROBES_A.map((p) => H.cpuProbeMax(water, grid, p));

    probe.setProbes(PROBES_B);
    const staleClearedOnSetProbes = probe.latest() === null;
    encoder = device.createCommandEncoder();
    probe.encode(encoder);
    device.queue.submit([encoder.finish()]);
    probe.requestReadback();
    const gpuB = Array.from(await waitForLatest(probe));
    const cpuB = PROBES_B.map((p) => H.cpuProbeMax(water, grid, p));

    probe.setProbes([]);
    const emptyProbeResultLength = probe.latest()?.length ?? -1;
    return {
      gpuA,
      cpuA,
      gpuB,
      cpuB,
      maxAbsDiff: Math.max(maxAbsDiff(gpuA, cpuA), maxAbsDiff(gpuB, cpuB)),
      staleClearedOnSetProbes,
      emptyProbeResultLength,
      errors: [],
    };
  } finally {
    probe.destroy();
  }
}
