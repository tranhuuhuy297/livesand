// WebGPU adapter/device bootstrap with human-readable failure messages for the "WebGPU unavailable" screen.

export class WebGpuUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WebGpuUnavailableError';
  }
}

export interface GpuContext {
  adapter: GPUAdapter;
  device: GPUDevice;
  format: GPUTextureFormat;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function createGpuContext(): Promise<GpuContext> {
  // WebGPU is only exposed in secure contexts, and plain-http LAN URLs are the most common reason it is missing.
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new WebGpuUnavailableError(
      'WebGPU needs a secure context. Open LiveSand via https:// or http://localhost instead of a LAN IP address.',
    );
  }
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    throw new WebGpuUnavailableError(
      'WebGPU is not available in this browser. Use a recent Chrome or Edge (113+), Safari 26+, or Firefox 141+ with hardware acceleration enabled.',
    );
  }

  let adapter: GPUAdapter | null;
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch (err) {
    throw new WebGpuUnavailableError(`Requesting a WebGPU adapter failed: ${describe(err)}`, { cause: err });
  }
  if (!adapter) {
    throw new WebGpuUnavailableError(
      'No WebGPU adapter was found. Your GPU may be blocklisted or hardware acceleration disabled (see chrome://gpu).',
    );
  }

  let device: GPUDevice;
  try {
    device = await adapter.requestDevice({ label: 'livesand-device' });
  } catch (err) {
    throw new WebGpuUnavailableError(`Creating a WebGPU device failed: ${describe(err)}`, { cause: err });
  }

  // Loss is not recoverable here; logging makes driver resets/timeouts visible instead of a silently frozen canvas.
  void device.lost.then((info) => {
    if (info.reason !== 'destroyed') console.error(`[livesand] WebGPU device lost (${info.reason}): ${info.message}`);
  });

  return { adapter, device, format: navigator.gpu.getPreferredCanvasFormat() };
}

export function configureCanvas(gpu: GpuContext, canvas: HTMLCanvasElement): GPUCanvasContext {
  const ctx = canvas.getContext('webgpu');
  if (!ctx) {
    throw new WebGpuUnavailableError('Could not get a WebGPU context for the canvas (it may already use another context type).');
  }
  ctx.configure({ device: gpu.device, format: gpu.format, alphaMode: 'opaque' });
  return ctx;
}
