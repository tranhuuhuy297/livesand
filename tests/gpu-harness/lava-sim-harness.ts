// Harness page entry: boots WebGPU and exposes the lava-sim scenarios on window for Playwright.
import { createGpuContext } from '../../src/gpu/gpu-context';
import { createLavaSimHarness } from './lava-sim-harness-scenarios';

async function boot(): Promise<void> {
  const status = document.getElementById('status');
  try {
    const gpu = await createGpuContext();
    const uncaptured: string[] = [];
    gpu.device.addEventListener('uncapturederror', (ev) => {
      uncaptured.push(`uncaptured: ${(ev as GPUUncapturedErrorEvent).error.message}`);
    });
    void gpu.device.lost.then((info) => uncaptured.push(`device lost (${info.reason}): ${info.message}`));
    window.__lavaSimHarness = createLavaSimHarness(gpu, uncaptured);
    if (status) status.textContent = `ready (${gpu.format})`;
  } catch (err) {
    window.__lavaSimHarnessError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    if (status) status.textContent = window.__lavaSimHarnessError;
  }
}

void boot();
