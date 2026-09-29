// Lava flow scenarios (downhill vs water, conservation, damming, deep-lava stability) returning plain numbers.
import { WaterSimPipes } from '../../src/gpu/water-sim-pipes';
import type { LavaConservationResult, LavaDamResult, LavaSlopeResult, LavaStabilityResult } from './lava-sim-harness-api';
import { LAVA_HARNESS_GRID as grid, add, frontX, runCoupled, sumColumns, withRig } from './lava-sim-harness-helpers';
import * as H from './water-sim-harness-helpers';

type Plain<T> = Omit<T, 'errors'>;

const SLOPE_STEPS = 200;

/** Same disc released on the same west-high slope as lava and as water for the same simulated time. */
export async function slopeScenario(device: GPUDevice): Promise<Plain<LavaSlopeResult>> {
  const terrain = H.field(grid, (x) => (grid.width - 1 - x) * 0.15);
  const start = H.disc(grid, 20, 22, 5, 2);
  const lava = await withRig(device, {}, async (rig) => {
    rig.lava.uploadBaseTerrain(terrain);
    rig.lava.uploadLava(start);
    const before = await rig.lava.readLava();
    await runCoupled(device, rig, SLOPE_STEPS, false);
    return { before, after: add(await rig.lava.readLava(), await rig.lava.readRock()) };
  });
  const water = new WaterSimPipes(device, grid, { evaporationPerSec: 0 });
  let waterAfter: Float32Array;
  try {
    water.uploadTerrain(terrain);
    water.uploadWater(start);
    await H.runSteps(device, water, SLOPE_STEPS);
    waterAfter = await water.readWater();
  } finally {
    water.destroy();
  }
  return {
    lavaFrontBefore: frontX(lava.before, grid, 0.02),
    lavaFrontAfter: frontX(lava.after, grid, 0.02),
    lavaCentroidBefore: H.centroidX(lava.before, grid),
    lavaCentroidAfter: H.centroidX(lava.after, grid),
    waterFrontAfter: frontX(waterAfter, grid, 0.02),
    waterCentroidBefore: H.centroidX(start, grid),
    waterCentroidAfter: H.centroidX(waterAfter, grid),
    lowSideX: grid.width - 1,
    relMaterialError: Math.abs(H.sum(lava.after) - H.sum(lava.before)) / H.sum(lava.before),
  };
}

/** Walls, bumpy ground, no emission: cooling may only move volume from lava into rock. */
export async function conservationScenario(device: GPUDevice): Promise<Plain<LavaConservationResult>> {
  return withRig(device, {}, async (rig) => {
    rig.lava.uploadBaseTerrain(H.bumpyTerrain(grid));
    rig.lava.uploadLava(H.disc(grid, 30, 22, 6, 5));
    const initial = H.sum(await rig.lava.readLava());
    await runCoupled(device, rig, 600, false);
    const lava = await rig.lava.readLava();
    const rock = await rig.lava.readRock();
    const lavaFinal = H.sum(lava);
    const rockFinal = H.sum(rock);
    const final = lavaFinal + rockFinal;
    return {
      initial,
      final,
      lavaFinal,
      rockFinal,
      relError: Math.abs(final - initial) / initial,
      minLava: H.minOf(lava),
      nanCount: H.countNaN(lava) + H.countNaN(rock),
    };
  });
}

const DAM_WALL_X0 = 40;
const DAM_WALL_X1 = 42;

/** A crater on a slope feeds a continuous flow into a base-terrain wall that must hold all of it back. */
export async function damScenario(device: GPUDevice): Promise<Plain<LavaDamResult>> {
  return withRig(device, {}, async (rig) => {
    const steps = 1000;
    const isWall = (x: number) => x >= DAM_WALL_X0 && x <= DAM_WALL_X1;
    rig.lava.uploadBaseTerrain(H.field(grid, (x) => (grid.width - 1 - x) * 0.12 + (isWall(x) ? 8 : 0)));
    const emission = H.disc(grid, 22, 22, 3, 0.8);
    rig.lava.uploadLavaEmission(emission);
    await runCoupled(device, rig, steps, false);
    const material = add(await rig.lava.readLava(), await rig.lava.readRock());
    const emitted = H.sum(emission) * rig.lava.params.dt * steps;
    const total = H.sum(material);
    return {
      emitted,
      material: total,
      relError: Math.abs(total - emitted) / emitted,
      wallX: DAM_WALL_X0,
      downstreamMaterial: sumColumns(material, grid, (x) => x > DAM_WALL_X1),
      materialNearWall: sumColumns(material, grid, (x) => x >= DAM_WALL_X0 - 6 && x < DAM_WALL_X0),
      materialFrontX: frontX(material, grid, 0.02),
    };
  });
}

/** Lava dam break (12 deep) plus a 30-deep tower, no cooling: pure flow must stay finite and conservative. */
export async function stabilityScenario(device: GPUDevice): Promise<Plain<LavaStabilityResult>> {
  return withRig(device, { lava: { coolingPerSec: 0, quenchPerSec: 0 } }, async (rig) => {
    const tower = H.disc(grid, 45, 22, 3, 30);
    const start = H.field(grid, (x, y) => Math.max(x < grid.width / 2 ? 12 : 0, tower[y * grid.width + x]));
    rig.lava.uploadLava(start);
    let maxLavaSeen = H.maxOf(start);
    let nanCount = 0;
    let minLava = Infinity;
    let last = start;
    for (let round = 0; round < 4; round++) {
      await runCoupled(device, rig, 250, false);
      last = await rig.lava.readLava();
      nanCount += H.countNaN(last);
      maxLavaSeen = Math.max(maxLavaSeen, H.maxOf(last));
      minLava = Math.min(minLava, H.minOf(last));
    }
    const relMassError = Math.abs(H.sum(last) - H.sum(start)) / H.sum(start);
    return { initialMax: H.maxOf(start), maxLavaSeen, nanCount, relMassError, minLava };
  });
}
