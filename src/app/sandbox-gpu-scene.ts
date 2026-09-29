// GPU side of a sandbox: water sim (+ optional lava), village probes, both renderers and one submission per frame.
import type { EdgeFlags, GridSize, VillageMarker } from '../core/types';
import type { GpuContext } from '../gpu/gpu-context';
import type { LavaSimParams } from '../gpu/lava-sim';
import { VillageWaterProbe, type WaterProbe } from '../gpu/village-water-probe';
import { WaterSimPipes } from '../gpu/water-sim-pipes';
import type { OrbitCamera } from '../render/orbit-camera';
import { Perspective3DRenderer } from '../render/perspective-3d-renderer';
import type { SourceMarker } from '../render/render-frame-uniforms';
import { DEFAULT_RENDER_STYLE, type RenderStyle } from '../render/shading-common-wgsl';
import { TopDownProjectorRenderer } from '../render/top-down-projector-renderer';
import type { ViewMode } from './app-url-params';
import { SceneLavaLayer, type LavaReading } from './scene-lava-layer';

export interface SceneFrame {
  steps: number;
  /** Lava steps this frame (0 while every flow is frozen: only a terrain compose runs, and only after uploads). */
  lavaSteps?: number;
  /** Encode the lava probes (villages + global maximum) this frame. */
  probeLava?: boolean;
  /** null skips drawing (fast-forward frames never touch the canvas). */
  view: ViewMode | null;
  camera: OrbitCamera | null;
  /** 2D only: map turned a quarter for portrait screens. */
  rotated?: boolean;
}

export class SandboxGpuScene {
  readonly sim: WaterSimPipes;
  /** Present when built with lava (virtual mode); projector mode never pays for it. */
  readonly lava: SceneLavaLayer | null;
  private readonly gpu: GpuContext;
  private readonly context: GPUCanvasContext;
  private readonly probe: VillageWaterProbe;
  private readonly topDown: TopDownProjectorRenderer;
  // Built on first 3D frame: projector mode never pays for the mesh buffers and MSAA targets.
  private perspective: Perspective3DRenderer | null = null;
  private style: RenderStyle;
  private villages: VillageMarker[] = [];
  private sources: SourceMarker[] = [];
  private probeCount = 0;
  private lavaShown = false;
  private destroyed = false;

  constructor(gpu: GpuContext, grid: GridSize, context: GPUCanvasContext, style: Partial<RenderStyle>, opts: { lava?: boolean } = {}) {
    this.gpu = gpu;
    this.context = context;
    this.style = { ...DEFAULT_RENDER_STYLE, ...style };
    this.sim = new WaterSimPipes(gpu.device, grid);
    this.lava = opts.lava ? new SceneLavaLayer(gpu.device, this.sim) : null;
    this.lava?.setParams({ seaLevel: this.style.seaLevel });
    this.probe = new VillageWaterProbe(gpu.device, this.sim);
    this.topDown = new TopDownProjectorRenderer(gpu, this.sim);
    this.topDown.setStyle(this.style);
  }

  get renderStyle(): Readonly<RenderStyle> {
    return this.style;
  }

  setStyle(patch: Partial<RenderStyle>): void {
    // Lava quenches in the painted sea, so the lava sim follows the displayed sea level.
    if (patch.seaLevel !== undefined && patch.seaLevel !== this.style.seaLevel) this.lava?.setParams({ seaLevel: patch.seaLevel });
    this.style = { ...this.style, ...patch };
    this.topDown.setStyle(patch);
    this.perspective?.setStyle(patch);
  }

  setVillages(markers: VillageMarker[]): void {
    this.villages = markers;
    this.topDown.setVillages(markers);
    this.perspective?.setVillages(markers);
  }

  setSources(markers: SourceMarker[]): void {
    this.sources = markers;
    this.topDown.setSources(markers);
    this.perspective?.setSources(markers);
  }

  setProbes(probes: WaterProbe[]): void {
    this.probe.setProbes(probes);
    this.probeCount = probes.length;
    this.lava?.setVillageProbes(probes);
  }

  /** Last completed probe readback (max water depth per village), or null while none has landed. */
  probeValues(): Float32Array | null {
    return this.probe.latest();
  }

  lavaReading(): LavaReading | null {
    return this.lava?.reading() ?? null;
  }

  setOpenEdges(openEdges: EdgeFlags): void {
    this.sim.setParams({ openEdges });
  }

  setLavaParams(patch: Partial<LavaSimParams>): void {
    this.lava?.setParams(patch);
  }

  /** CPU heights: the lava sim's base ground when lava exists (it composes the water terrain), else the water terrain. */
  uploadTerrain(heights: Float32Array): void {
    if (this.lava) this.lava.uploadBaseTerrain(heights);
    else this.sim.uploadTerrain(heights);
  }

  /** Binds lava + rock to the renderers; the first bind compiles the lava shaders, so call it at level load. */
  setLavaVisible(on: boolean): void {
    if (!this.lava || this.destroyed || on === this.lavaShown) return;
    this.lavaShown = on;
    const src = on ? this.lava.source : null;
    this.topDown.setLavaSource(src);
    this.perspective?.setLavaSource(src);
  }

  /** Runs `steps` water steps right away without drawing (level prefill). */
  runSteps(steps: number): void {
    if (this.destroyed || steps <= 0) return;
    const encoder = this.gpu.device.createCommandEncoder({ label: 'livesand-prefill' });
    this.lava?.encode(encoder, 0);
    this.sim.encodeSteps(encoder, steps);
    this.gpu.device.queue.submit([encoder.finish()]);
  }

  /** Encodes lava and water steps, probes and the view into one command buffer, submits, then starts readbacks. */
  submitFrame(frame: SceneFrame): void {
    if (this.destroyed) return;
    const device = this.gpu.device;
    const encoder = device.createCommandEncoder({ label: 'livesand-frame' });
    this.lava?.encode(encoder, frame.lavaSteps ?? 0);
    this.sim.encodeSteps(encoder, frame.steps);
    if (this.probeCount > 0) this.probe.encode(encoder);
    const probeLava = Boolean(this.lava && frame.probeLava);
    if (probeLava) this.lava?.encodeProbe(encoder);
    if (frame.view) {
      const texture = this.context.getCurrentTexture();
      const target = texture.createView();
      if (frame.view === '3d') {
        const renderer = this.ensurePerspective();
        if (frame.camera) renderer.setCamera(frame.camera.viewProjection(texture.width / texture.height), frame.camera.eye());
        renderer.render(encoder, target, texture.width, texture.height);
      } else {
        this.topDown.render(encoder, target, frame.rotated ?? false);
      }
    }
    device.queue.submit([encoder.finish()]);
    if (this.probeCount > 0) this.probe.requestReadback();
    if (probeLava) this.lava?.requestReadback();
  }

  destroy(): void {
    if (this.destroyed) return;
    // Renderers must drop the lava buffers before they are freed, or later submits fail validation.
    this.setLavaVisible(false);
    this.destroyed = true;
    this.perspective?.destroy();
    this.topDown.destroy();
    this.probe.destroy();
    this.lava?.destroy();
    this.sim.destroy();
  }

  private ensurePerspective(): Perspective3DRenderer {
    if (!this.perspective) {
      this.perspective = new Perspective3DRenderer(this.gpu, this.sim);
      this.perspective.setStyle(this.style);
      this.perspective.setVillages(this.villages);
      this.perspective.setSources(this.sources);
      if (this.lava && this.lavaShown) this.perspective.setLavaSource(this.lava.source);
    }
    return this.perspective;
  }
}
