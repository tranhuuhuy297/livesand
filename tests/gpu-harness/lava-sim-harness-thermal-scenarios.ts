// Lava cooling/quench scenarios plus API validation, each returning plain numbers the Playwright spec asserts on.
import { LavaSim } from '../../src/gpu/lava-sim';
import type { LavaCoolingResult, LavaInputValidationResult, LavaQuenchResult } from './lava-sim-harness-api';
import { LAVA_HARNESS_GRID as grid, composeMaxAbsDiff, extentFrom, readTerrain, runCoupled, withRig } from './lava-sim-harness-helpers';
import * as H from './water-sim-harness-helpers';

type Plain<T> = Omit<T, 'errors'>;

/** A lava pile on flat raised ground spreads, stalls and freezes; the water terrain must equal base + rock + lava. */
export async function coolingScenario(device: GPUDevice): Promise<Plain<LavaCoolingResult>> {
  return withRig(device, { lava: { coolingPerSec: 0.1 } }, async (rig) => {
    const cx = 30;
    const cy = 22;
    const base = H.field(grid, () => 1.5);
    rig.lava.uploadBaseTerrain(base);
    rig.lava.uploadLava(H.disc(grid, cx, cy, 6, 3));
    const initialLava = H.sum(await rig.lava.readLava());
    await runCoupled(device, rig, 1500, false);
    const lava = await rig.lava.readLava();
    const rock = await rig.lava.readRock();
    const terrain = await readTerrain(device, rig);

    // A zero-step encode must still publish a freshly uploaded base terrain.
    const newBase = H.bumpyTerrain(grid);
    rig.lava.uploadBaseTerrain(newBase);
    const encoder = device.createCommandEncoder();
    rig.lava.encodeSteps(encoder, 0);
    device.queue.submit([encoder.finish()]);
    const terrainZeroStep = await readTerrain(device, rig);
    const centre = cy * grid.width + cx;
    return {
      initialLava,
      finalLava: H.sum(lava),
      finalRock: H.sum(rock),
      extentRadius: extentFrom(rock, grid, cx, cy, 0.01),
      wallDistance: Math.min(cx, cy, grid.width - 1 - cx, grid.height - 1 - cy),
      terrainMaxAbsDiff: composeMaxAbsDiff(terrain, base, rock, lava),
      zeroStepMaxAbsDiff: composeMaxAbsDiff(terrainZeroStep, newBase, rock, lava),
      terrainRiseAtCentre: terrain[centre] - base[centre],
    };
  });
}

const QUENCH_STEPS = 800;
const LAKE_LEVEL = 2;

/** A crater on a hill feeds lava down into a lake: new rock in the lake, water boiled off versus a lava-free control. */
export async function quenchScenario(device: GPUDevice): Promise<Plain<LavaQuenchResult>> {
  const terrain = H.field(grid, (x) => Math.max(0, 30 - x) * 0.25);
  const lake = terrain.map((h) => Math.max(0, LAKE_LEVEL - h));
  const inLake = (i: number) => lake[i] > 0.05;
  const run = (withLava: boolean, quenchPerSec?: number) =>
    withRig(device, { lava: { quenchPerSec } }, async (rig) => {
      rig.lava.uploadBaseTerrain(terrain);
      rig.water.uploadWater(lake);
      if (withLava) rig.lava.uploadLavaEmission(H.disc(grid, 6, 22, 3, 1));
      const waterInitial = H.sum(await rig.water.readWater());
      await runCoupled(device, rig, QUENCH_STEPS, true);
      const lava = await rig.lava.readLava();
      const rock = await rig.lava.readRock();
      let rockInPool = 0;
      let lavaInPool = 0;
      for (let i = 0; i < lake.length; i++) {
        if (!inLake(i)) continue;
        rockInPool += rock[i];
        lavaInPool += lava[i];
      }
      return { waterInitial, waterFinal: H.sum(await rig.water.readWater()), rockInPool, lavaInPool };
    });
  const hot = await run(true);
  const noQuench = await run(true, 0);
  const control = await run(false);
  const solidFraction = (r: { rockInPool: number; lavaInPool: number }) =>
    r.rockInPool + r.lavaInPool > 0 ? r.rockInPool / (r.rockInPool + r.lavaInPool) : 0;
  return {
    waterInitial: hot.waterInitial,
    waterFinal: hot.waterFinal,
    controlWaterFinal: control.waterFinal,
    rockInPool: hot.rockInPool,
    lavaInPool: hot.lavaInPool,
    poolSolidFraction: solidFraction(hot),
    noQuenchPoolSolidFraction: solidFraction(noQuench),
  };
}

/** Bad sizes/params throw RangeError, bad values are sanitised, clear() resets, destroyed sims refuse work. */
export async function inputValidationScenario(device: GPUDevice): Promise<Plain<LavaInputValidationResult>> {
  return withRig(device, {}, async (rig) => {
    const n = grid.width * grid.height;
    const attempts: Array<() => unknown> = [
      () => new LavaSim(device, { grid: { width: 0, height: 4 }, buffers: rig.water.buffers }),
      () => new LavaSim(device, { grid: { width: grid.width + 1, height: grid.height }, buffers: rig.water.buffers }),
      () => new LavaSim(device, rig.water, { dt: 0 }),
      () => rig.lava.uploadBaseTerrain(new Float32Array(3)),
      () => rig.lava.uploadLava(new Float32Array(n + 1)),
      () => rig.lava.uploadLavaEmission(new Float32Array(1)),
      () => rig.lava.encodeSteps(device.createCommandEncoder(), -1),
      () => rig.lava.encodeSteps(device.createCommandEncoder(), 1.5),
      () => rig.lava.setParams({ damping: 2 }),
      () => rig.lava.setParams({ coolingPerSec: -1 }),
      () => rig.lava.setParams({ quenchPerSec: NaN }),
      () => rig.lava.setParams({ steamPerSec: Infinity }),
    ];
    let rangeErrorsThrown = 0;
    for (const attempt of attempts) {
      try {
        attempt();
      } catch (err) {
        if (err instanceof RangeError) rangeErrorsThrown++;
      }
    }
    const dirty = H.field(grid, () => 1);
    dirty[5] = NaN;
    dirty[6] = -3;
    rig.lava.uploadLava(dirty);
    const back = await rig.lava.readLava();

    const base = H.bumpyTerrain(grid);
    rig.lava.uploadBaseTerrain(base);
    rig.lava.uploadLava(H.disc(grid, 30, 22, 6, 4));
    await runCoupled(device, rig, 80, false);
    rig.lava.clear();
    const clearedLava = await rig.lava.readLava();
    const clearedRock = await rig.lava.readRock();
    const terrain = await readTerrain(device, rig);

    const doomed = new LavaSim(device, rig.water);
    doomed.destroy();
    doomed.destroy();
    let destroyedThrows = false;
    try {
      doomed.uploadLava(new Float32Array(n));
    } catch {
      destroyedThrows = true;
    }
    return {
      rangeErrorsThrown,
      rangeErrorsExpected: attempts.length,
      sanitizedNaN: back[5],
      sanitizedNegative: back[6],
      clearedLava: H.sum(clearedLava),
      clearedRock: H.sum(clearedRock),
      terrainAfterClearMaxAbsDiff: composeMaxAbsDiff(terrain, base, clearedRock, clearedLava),
      destroyedThrows,
    };
  });
}
