// Wires the lava flow/thermal scenarios into the window API, each wrapped in GPU error scopes.
import type { GpuContext } from '../../src/gpu/gpu-context';
import type { LavaSimHarnessApi } from './lava-sim-harness-api';
import { conservationScenario, damScenario, slopeScenario, stabilityScenario } from './lava-sim-harness-flow-scenarios';
import { coolingScenario, inputValidationScenario, quenchScenario } from './lava-sim-harness-thermal-scenarios';
import { withErrorScopes } from './water-sim-harness-helpers';

export function createLavaSimHarness(gpu: GpuContext, uncaptured: string[]): LavaSimHarnessApi {
  const { device } = gpu;
  const scoped = <T extends object>(fn: (device: GPUDevice) => Promise<T>) => () => withErrorScopes(device, uncaptured, () => fn(device));
  return {
    slope: scoped(slopeScenario),
    conservation: scoped(conservationScenario),
    cooling: scoped(coolingScenario),
    dam: scoped(damScenario),
    quench: scoped(quenchScenario),
    stability: scoped(stabilityScenario),
    inputValidation: scoped(inputValidationScenario),
    uncapturedErrors: () => [...uncaptured],
  };
}
