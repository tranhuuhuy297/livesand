// Renders the demo scene with both renderers; exposes errors + pixel statistics on window.__harness for e2e.
import { TopDownProjectorRenderer } from '../../src/render/top-down-projector-renderer';
import { Perspective3DRenderer } from '../../src/render/perspective-3d-renderer';
import { OrbitCamera } from '../../src/render/orbit-camera';
import type { GridSize, SimGpuBuffers } from '../../src/core/types';
import { buildHarnessScene, type HarnessScene } from './renderers-harness-scene';

interface PixelStats {
  distinctColors: number;
  lumaStdDev: number;
  probes: Record<string, [number, number, number]>;
}

interface HarnessState {
  ready: boolean;
  error?: string;
  errors: string[];
  stats?: { view2d: PixelStats; view3d: PixelStats };
  renderAt?: (timeSec: number) => Promise<void>;
}

declare global {
  interface Window {
    __harness: HarnessState;
  }
}

const state: HarnessState = { ready: false, errors: [] };
window.__harness = state;

const GRID: GridSize = { width: 256, height: 192 };
const PROBES_2D: Record<string, [number, number]> = { lake: [180 / 256, 134 / 192], mountain: [60 / 256, 56 / 192] };
const PROBES_3D: Record<string, [number, number]> = { sky: [0.5, 0.02], centre: [0.5, 0.55] };

function createSimBuffers(device: GPUDevice, grid: GridSize, scene: HarnessScene): SimGpuBuffers {
  const make = (label: string, data: Float32Array): GPUBuffer => {
    const buffer = device.createBuffer({
      label,
      size: data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  };
  return {
    terrain: make('harness terrain', scene.terrain),
    water: make('harness water', scene.water),
    flux: make('harness flux', scene.flux),
    emission: make('harness emission', scene.emission),
    grid,
  };
}

function pixelStats(data: Uint8Array, width: number, height: number, bgra: boolean, probes: Record<string, [number, number]>): PixelStats {
  const rgbAt = (px: number, py: number): [number, number, number] => {
    const o = (Math.min(height - 1, py) * width + Math.min(width - 1, px)) * 4;
    return bgra ? [data[o + 2], data[o + 1], data[o]] : [data[o], data[o + 1], data[o + 2]];
  };
  const colors = new Set<number>();
  const lumas: number[] = [];
  for (let sy = 0; sy < 48; sy++) {
    for (let sx = 0; sx < 64; sx++) {
      const [r, g, b] = rgbAt(Math.floor(((sx + 0.5) / 64) * width), Math.floor(((sy + 0.5) / 48) * height));
      colors.add(((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2));
      lumas.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
    }
  }
  const mean = lumas.reduce((a, b) => a + b, 0) / lumas.length;
  const variance = lumas.reduce((a, b) => a + (b - mean) ** 2, 0) / lumas.length;
  const probeColors: Record<string, [number, number, number]> = {};
  for (const [name, [u, v]] of Object.entries(probes)) probeColors[name] = rgbAt(Math.floor(u * width), Math.floor(v * height));
  return { distinctColors: colors.size, lumaStdDev: Math.sqrt(variance), probes: probeColors };
}

/** Copies GPU readback (rgba/bgra) into a 2D canvas; avoids WebGPU canvas presentation, which headless shells may lack. */
function blitToCanvas(canvas: HTMLCanvasElement, data: Uint8Array, bgra: boolean): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(`Canvas #${canvas.id} has no 2D context`);
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let o = 0; o < image.data.length; o += 4) {
    image.data[o] = data[o + (bgra ? 2 : 0)];
    image.data[o + 1] = data[o + 1];
    image.data[o + 2] = data[o + (bgra ? 0 : 2)];
    image.data[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

async function main(): Promise<void> {
  if (!navigator.gpu) throw new Error('WebGPU is not available in this browser');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter');
  const device = await adapter.requestDevice();
  device.addEventListener('uncapturederror', (ev) => state.errors.push((ev as GPUUncapturedErrorEvent).error.message));
  void device.lost.then((info) => state.errors.push(`device lost: ${info.message}`));
  const format = navigator.gpu.getPreferredCanvasFormat();
  const gpu = { adapter, device, format };

  const scene = buildHarnessScene(GRID);
  const sim = { grid: GRID, buffers: createSimBuffers(device, GRID, scene) };
  const canvases = ['#view2d', '#view3d'].map((sel) => document.querySelector<HTMLCanvasElement>(sel));
  const [canvas2d, canvas3d] = canvases;
  if (!canvas2d || !canvas3d) throw new Error('Harness canvases missing');

  device.pushErrorScope('validation');
  const topDown = new TopDownProjectorRenderer(gpu, sim);
  const perspective = new Perspective3DRenderer(gpu, sim);
  const params = new URLSearchParams(location.search);
  const num = (key: string, fallback: number): number => {
    const v = Number(params.get(key));
    return params.has(key) && Number.isFinite(v) ? v : fallback;
  };
  const camera = new OrbitCamera(GRID);
  camera.rotate(num('yaw', 0), num('pitch', 0));
  camera.zoom(num('zoom', 1));
  const style = { minHeight: 0, maxHeight: 40, showHillshade: !params.has('flat') };
  topDown.setVillages(scene.villages);
  perspective.setVillages(scene.villages);
  const targets = [canvas2d, canvas3d].map((c) =>
    device.createTexture({
      label: `harness target ${c.id}`,
      size: [c.width, c.height],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    }),
  );
  const readback = [canvas2d, canvas3d].map((c) =>
    device.createBuffer({ size: c.width * c.height * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
  );
  const setupError = await device.popErrorScope();
  if (setupError) state.errors.push(`setup: ${setupError.message}`);

  const renderAt = async (timeSec: number): Promise<void> => {
    device.pushErrorScope('validation');
    topDown.setStyle({ ...style, timeSec });
    perspective.setStyle({ ...style, timeSec });
    perspective.setCamera(camera.viewProjection(canvas3d.width / canvas3d.height), camera.eye());
    const encoder = device.createCommandEncoder();
    topDown.render(encoder, targets[0].createView());
    perspective.render(encoder, targets[1].createView(), canvas3d.width, canvas3d.height);
    targets.forEach((tex, i) =>
      encoder.copyTextureToBuffer({ texture: tex }, { buffer: readback[i], bytesPerRow: tex.width * 4 }, [tex.width, tex.height]),
    );
    device.queue.submit([encoder.finish()]);
    const renderError = await device.popErrorScope();
    if (renderError) state.errors.push(`render: ${renderError.message}`);
    const bgra = format === 'bgra8unorm';
    const [s2d, s3d] = await Promise.all(
      readback.map(async (buf, i) => {
        await buf.mapAsync(GPUMapMode.READ);
        const data = new Uint8Array(buf.getMappedRange().slice(0));
        buf.unmap();
        const c = i === 0 ? canvas2d : canvas3d;
        blitToCanvas(c, data, bgra);
        return pixelStats(data, c.width, c.height, bgra, i === 0 ? PROBES_2D : PROBES_3D);
      }),
    );
    state.stats = { view2d: s2d, view3d: s3d };
  };

  state.renderAt = renderAt;
  await renderAt(num('t', 2.0));
  state.ready = true;

  if (params.has('animate')) {
    const start = performance.now();
    const loop = (): void => {
      camera.rotate(0.004, 0);
      void renderAt((performance.now() - start) / 1000).then(() => requestAnimationFrame(loop));
    };
    requestAnimationFrame(loop);
  }
}

main().catch((err: unknown) => {
  state.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error('renderers harness failed', err);
});
