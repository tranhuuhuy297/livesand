// Physics scenarios for WaterSimPipes, each returning plain numbers the Playwright spec can assert on.
import type { GridSize } from '../../src/core/types';
import { configureCanvas, type GpuContext } from '../../src/gpu/gpu-context';
import { WaterSimPipes, type WaterSimParams } from '../../src/gpu/water-sim-pipes';
import type { WaterSimHarnessApi } from './water-sim-harness-api';
import * as H from './water-sim-harness-helpers';
import { runProbeScenario } from './water-sim-harness-probe-scenario';

/** Odd sizes exercise the partial-workgroup bounds checks. */
export const HARNESS_GRID: GridSize = { width: 61, height: 45 };

export function createWaterSimHarness(gpu: GpuContext, uncaptured: string[]): WaterSimHarnessApi {
  const { device } = gpu;
  const grid = HARNESS_GRID;
  const scoped = <T extends object>(fn: () => Promise<T>) => H.withErrorScopes(device, uncaptured, fn);
  // Every scenario gets a fresh sim and always frees it, even when an assertion-worthy exception escapes.
  const withSim = async <T>(params: Partial<WaterSimParams>, fn: (sim: WaterSimPipes) => Promise<T>): Promise<T> => {
    const sim = new WaterSimPipes(device, grid, params);
    try {
      return await fn(sim);
    } finally {
      sim.destroy();
    }
  };

  return {
    conservation: () =>
      scoped(() =>
        withSim({ evaporationPerSec: 0 }, async (sim) => {
          sim.uploadTerrain(H.bumpyTerrain(grid));
          sim.uploadWater(H.disc(grid, 30, 22, 6, 5));
          const w0 = await sim.readWater();
          await H.runSteps(device, sim, 500);
          const w1 = await sim.readWater();
          const initial = H.sum(w0);
          const final = H.sum(w1);
          return { initial, final, relError: Math.abs(final - initial) / initial, minDepth: H.minOf(w1), nanCount: H.countNaN(w1) };
        }),
      ),

    downhill: () =>
      scoped(() =>
        withSim({ evaporationPerSec: 0 }, async (sim) => {
          // High on the west edge, low on the east edge.
          sim.uploadTerrain(H.field(grid, (x) => (grid.width - 1 - x) * 0.15));
          sim.uploadWater(H.disc(grid, 30, 22, 5, 2));
          const w0 = await sim.readWater();
          await H.runSteps(device, sim, 300);
          const w1 = await sim.readWater();
          return {
            centroidBefore: H.centroidX(w0, grid),
            centroidAfter: H.centroidX(w1, grid),
            lowSideX: grid.width - 1,
            relMassError: Math.abs(H.sum(w1) - H.sum(w0)) / H.sum(w0),
          };
        }),
      ),

    drain: () =>
      scoped(async () => {
        const run = (south: boolean) =>
          withSim({ evaporationPerSec: 0, openEdges: { north: false, east: false, south, west: false } }, async (sim) => {
            sim.uploadTerrain(H.field(grid, (_x, y) => (grid.height - 1 - y) * 0.05));
            sim.uploadWater(H.field(grid, () => 1));
            const w0 = await sim.readWater();
            await H.runSteps(device, sim, 1500);
            return [H.sum(w0), H.sum(await sim.readWater())] as const;
          });
        const [initial, openFinal] = await run(true);
        const [, closedFinal] = await run(false);
        return { initial, openFinal, closedFinal };
      }),

    emission: () =>
      scoped(async () => {
        const rate = 0.4;
        const steps = 200;
        const uniform = await withSim({ evaporationPerSec: 0 }, async (sim) => {
          sim.uploadEmission(H.field(grid, () => rate));
          await H.runSteps(device, sim, steps);
          const w = await sim.readWater();
          return { expected: rate * sim.params.dt * steps, w };
        });
        const spring = await withSim({ evaporationPerSec: 0 }, async (sim) => {
          const em = H.disc(grid, 15, 15, 4, 2);
          sim.uploadTerrain(H.bumpyTerrain(grid));
          sim.uploadEmission(em);
          await H.runSteps(device, sim, 300);
          return { expected: H.sum(em) * sim.params.dt * 300, total: H.sum(await sim.readWater()) };
        });
        const evaporation = await withSim({ evaporationPerSec: 0.2 }, async (sim) => {
          sim.uploadWater(H.field(grid, () => 1));
          await H.runSteps(device, sim, 100);
          const w = await sim.readWater();
          return { expected: (1 - 0.2 * sim.params.dt) ** 100, mean: H.sum(w) / w.length };
        });
        return {
          expectedPerCell: uniform.expected,
          meanPerCell: H.sum(uniform.w) / uniform.w.length,
          minPerCell: H.minOf(uniform.w),
          maxPerCell: H.maxOf(uniform.w),
          springExpectedTotal: spring.expected,
          springTotal: spring.total,
          evaporationExpected: evaporation.expected,
          evaporationMean: evaporation.mean,
        };
      }),

    probe: () => scoped(() => withSim({}, (sim) => runProbeScenario(device, sim))),

    stability: () =>
      scoped(() =>
        withSim({ evaporationPerSec: 0 }, async (sim) => {
          // Dam break: an 8-deep wall of water released against the east wall and reflected back.
          const w0 = H.field(grid, (x) => (x < grid.width / 2 ? 8 : 0));
          sim.uploadWater(w0);
          let maxDepthSeen = H.maxOf(w0);
          let nanCount = 0;
          let last = w0;
          for (let round = 0; round < 4; round++) {
            await H.runSteps(device, sim, 250);
            last = await sim.readWater();
            nanCount += H.countNaN(last);
            maxDepthSeen = Math.max(maxDepthSeen, H.maxOf(last));
          }
          const relMassError = Math.abs(H.sum(last) - H.sum(w0)) / H.sum(w0);
          return { initialMax: H.maxOf(w0), maxDepthSeen, nanCount, relMassError };
        }),
      ),

    inputValidation: () =>
      scoped(() =>
        withSim({}, async (sim) => {
          const attempts: Array<() => unknown> = [
            () => sim.uploadTerrain(new Float32Array(3)),
            () => sim.uploadWater(new Float32Array(grid.width * grid.height + 1)),
            () => sim.encodeSteps(device.createCommandEncoder(), -1),
            () => sim.encodeSteps(device.createCommandEncoder(), 1.5),
            () => sim.setParams({ dt: 0 }),
            () => sim.setParams({ damping: 2 }),
            () => new WaterSimPipes(device, { width: 0, height: 4 }),
          ];
          let rangeErrorsThrown = 0;
          for (const attempt of attempts) {
            try {
              attempt();
            } catch (err) {
              if (err instanceof RangeError) rangeErrorsThrown++;
            }
          }
          const w = H.field(grid, () => 1);
          w[5] = NaN;
          w[6] = -3;
          sim.uploadWater(w);
          const back = await sim.readWater();
          return { rangeErrorsThrown, rangeErrorsExpected: attempts.length, sanitizedNaN: back[5], sanitizedNegative: back[6] };
        }),
      ),

    canvas: () =>
      scoped(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 48;
        document.body.append(canvas);
        try {
          // No getCurrentTexture(): presenting is the renderers' job and kills the device on headless Vulkan SwiftShader
          // unless Chromium runs with --use-angle=swiftshader.
          const config = configureCanvas(gpu, canvas).getConfiguration();
          return { format: config?.format ?? 'unconfigured', alphaMode: config?.alphaMode ?? 'unconfigured' };
        } finally {
          canvas.remove();
        }
      }),

    uncapturedErrors: () => [...uncaptured],
  };
}
