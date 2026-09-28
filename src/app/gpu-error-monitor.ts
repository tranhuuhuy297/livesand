// Collects uncaptured WebGPU errors (for the debug API) and turns device loss into a fatal, user-visible error.

const MAX_KEPT_ERRORS = 20;

export class GpuErrorMonitor {
  readonly errors: string[] = [];
  private readonly seen = new Set<string>();

  constructor(device: GPUDevice, onDeviceLost: (message: string) => void) {
    device.addEventListener('uncapturederror', (ev) => {
      const message = (ev as GPUUncapturedErrorEvent).error?.message ?? 'unknown WebGPU error';
      // The same validation error repeats every frame; log it once so the console stays readable.
      if (this.seen.has(message)) return;
      this.seen.add(message);
      if (this.errors.length < MAX_KEPT_ERRORS) this.errors.push(message);
      console.error(`[livesand] WebGPU error: ${message}`);
    });
    void device.lost.then((info) => {
      if (info.reason === 'destroyed') return;
      onDeviceLost(`The GPU stopped responding (${info.message || 'device lost'}). Reload the page to continue.`);
    });
  }
}
