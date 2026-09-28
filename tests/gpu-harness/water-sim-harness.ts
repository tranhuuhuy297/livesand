// Harness page entry: boots WebGPU and exposes the water-sim scenarios on window for Playwright.
import { createGpuContext } from '../../src/gpu/gpu-context';
import { createWaterSimHarness } from './water-sim-harness-scenarios';

async function boot(): Promise<void> {
  const status = document.getElementById('status');
  try {
    const gpu = await createGpuContext();
    const uncaptured: string[] = [];
    gpu.device.addEventListener('uncapturederror', (ev) => {
      uncaptured.push(`uncaptured: ${(ev as GPUUncapturedErrorEvent).error.message}`);
    });
    void gpu.device.lost.then((info) => uncaptured.push(`device lost (${info.reason}): ${info.message}`));
    window.__waterSimHarness = createWaterSimHarness(gpu, uncaptured);
    if (status) status.textContent = `ready (${gpu.format})`;
  } catch (err) {
    window.__waterSimHarnessError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    if (status) status.textContent = window.__waterSimHarnessError;
  }
}

void boot();
