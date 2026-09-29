// Renders a demo scene (?scene=volcano for lava) with both renderers; exposes errors + pixel statistics on window.__harness.
import { TopDownProjectorRenderer } from '../../src/render/top-down-projector-renderer';
import { Perspective3DRenderer } from '../../src/render/perspective-3d-renderer';
import { OrbitCamera } from '../../src/render/orbit-camera';
import type { GridSize, SimGpuBuffers } from '../../src/core/types';
import { buildHarnessScene, type HarnessScene } from './renderers-harness-scene';
import { buildVolcanoScene, volcanoProbes } from './renderers-harness-lava-scene';
import { blitToCanvas, pixelStats, type PixelStats, type Probe } from './renderers-harness-pixels';

interface HarnessState {
  ready: boolean;
  error?: string;
  errors: string[];
  stats?: { view2d: PixelStats; view3d: PixelStats };
  renderAt?: (timeSec: number) => Promise<void>;
  /** Volcano scene only: unbinds (false) or rebinds (true) the lava source on both renderers. */
  setLava?: (on: boolean) => void;
  /** GPU-only timing: ms per frame for one view drawn `frames` times (no readback). */
  benchmark?: (view: '2d' | '3d', frames: number) => Promise<number>;
}

declare global {
  interface Window {
    __harness: HarnessState;
  }
}

const state: HarnessState = { ready: false, errors: [] };
window.__harness = state;

const GRID: GridSize = { width: 256, height: 192 };
const PROBES_2D: Record<string, Probe> = { lake: { u: 180 / 256, v: 134 / 192, radius: 0 }, mountain: { u: 60 / 256, v: 56 / 192, radius: 0 } };
const PROBES_3D: Record<string, Probe> = { sky: { u: 0.5, v: 0.02, radius: 0 }, centre: { u: 0.5, v: 0.55, radius: 0 } };

function makeStorage(device: GPUDevice, label: string, data: Float32Array): GPUBuffer {
  const buffer = device.createBuffer({
    label,
    size: data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  device.queue.writeBuffer(buffer, 0, data);
  return buffer;
}

function createSimBuffers(device: GPUDevice, grid: GridSize, scene: HarnessScene): SimGpuBuffers {
  return {
    terrain: makeStorage(device, 'harness terrain', scene.terrain),
    water: makeStorage(device, 'harness water', scene.water),
    flux: makeStorage(device, 'harness flux', scene.flux),
    emission: makeStorage(device, 'harness emission', scene.emission),
    grid,
  };
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

  const params = new URLSearchParams(location.search);
  const volcano = params.get('scene') === 'volcano';
  const lavaScene = volcano ? buildVolcanoScene(GRID) : null;
  const scene: HarnessScene = lavaScene ?? buildHarnessScene(GRID);
  const sim = { grid: GRID, buffers: createSimBuffers(device, GRID, scene) };
  const canvases = ['#view2d', '#view3d'].map((sel) => document.querySelector<HTMLCanvasElement>(sel));
  const [canvas2d, canvas3d] = canvases;
  if (!canvas2d || !canvas3d) throw new Error('Harness canvases missing');

  device.pushErrorScope('validation');
  const topDown = new TopDownProjectorRenderer(gpu, sim);
  const perspective = new Perspective3DRenderer(gpu, sim);
  const lavaSource = lavaScene
    ? { lava: makeStorage(device, 'harness lava', lavaScene.lava), rock: makeStorage(device, 'harness rock', lavaScene.rock) }
    : null;
  topDown.setLavaSource(lavaSource);
  perspective.setLavaSource(lavaSource);
  if (lavaSource) {
    // An undersized source must be rejected and leave the working one bound.
    const tiny = makeStorage(device, 'harness tiny lava', new Float32Array(4));
    try {
      perspective.setLavaSource({ lava: tiny, rock: tiny });
      state.errors.push('undersized lava source was accepted');
    } catch {
      /* expected */
    }
  }
  const num = (key: string, fallback: number): number => {
    const v = Number(params.get(key));
    return params.has(key) && Number.isFinite(v) ? v : fallback;
  };
  const camera = new OrbitCamera(GRID);
  if (volcano) {
    // Closer three-quarter view: into the crater's lava lake, down the flow, onto the steaming shore.
    camera.target = [-14, 16, 0];
    camera.yaw = 0.55;
    camera.pitch = 0.62;
    camera.distance = GRID.width * 0.62;
  }
  // Optional close-up framing (world coordinates), e.g. ?target=-44,40,-26 for the crater.
  const target = params.get('target')?.split(',').map(Number);
  if (target?.length === 3 && target.every(Number.isFinite)) camera.target = [target[0], target[1], target[2]];
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
    const viewProj = camera.viewProjection(canvas3d.width / canvas3d.height);
    const probes = lavaScene ? volcanoProbes(lavaScene, GRID, viewProj) : { p2d: PROBES_2D, p3d: PROBES_3D };
    const [s2d, s3d] = await Promise.all(
      readback.map(async (buf, i) => {
        await buf.mapAsync(GPUMapMode.READ);
        const data = new Uint8Array(buf.getMappedRange().slice(0));
        buf.unmap();
        const c = i === 0 ? canvas2d : canvas3d;
        blitToCanvas(c, data, bgra);
        return pixelStats(data, c.width, c.height, bgra, i === 0 ? probes.p2d : probes.p3d);
      }),
    );
    state.stats = { view2d: s2d, view3d: s3d };
  };

  state.renderAt = renderAt;
  state.setLava = (on) => {
    topDown.setLavaSource(on ? lavaSource : null);
    perspective.setLavaSource(on ? lavaSource : null);
  };
  state.benchmark = async (view, frames) => {
    await device.queue.onSubmittedWorkDone();
    const start = performance.now();
    for (let i = 0; i < frames; i++) {
      const encoder = device.createCommandEncoder();
      if (view === '2d') topDown.render(encoder, targets[0].createView());
      else perspective.render(encoder, targets[1].createView(), canvas3d.width, canvas3d.height);
      device.queue.submit([encoder.finish()]);
    }
    await device.queue.onSubmittedWorkDone();
    return (performance.now() - start) / frames;
  };
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
