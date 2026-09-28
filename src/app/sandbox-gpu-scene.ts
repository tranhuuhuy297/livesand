// GPU side of a sandbox: water sim, village probes, both renderers and one command submission per frame.
import type { EdgeFlags, GridSize, VillageMarker } from '../core/types';
import type { GpuContext } from '../gpu/gpu-context';
import { VillageWaterProbe, type WaterProbe } from '../gpu/village-water-probe';
import { WaterSimPipes } from '../gpu/water-sim-pipes';
import type { OrbitCamera } from '../render/orbit-camera';
import { Perspective3DRenderer } from '../render/perspective-3d-renderer';
import { DEFAULT_RENDER_STYLE, type RenderStyle } from '../render/shading-common-wgsl';
import { TopDownProjectorRenderer } from '../render/top-down-projector-renderer';
import type { ViewMode } from './app-url-params';

export interface SceneFrame {
  steps: number;
  /** null skips drawing (fast-forward frames never touch the canvas). */
  view: ViewMode | null;
  camera: OrbitCamera | null;
}

export class SandboxGpuScene {
  readonly sim: WaterSimPipes;
  private readonly gpu: GpuContext;
  private readonly context: GPUCanvasContext;
  private readonly probe: VillageWaterProbe;
  private readonly topDown: TopDownProjectorRenderer;
  // Built on first 3D frame: projector mode never pays for the mesh buffers and MSAA targets.
  private perspective: Perspective3DRenderer | null = null;
  private style: RenderStyle;
  private villages: VillageMarker[] = [];
  private probeCount = 0;
  private destroyed = false;

  constructor(gpu: GpuContext, grid: GridSize, context: GPUCanvasContext, style: Partial<RenderStyle>) {
    this.gpu = gpu;
    this.context = context;
    this.style = { ...DEFAULT_RENDER_STYLE, ...style };
    this.sim = new WaterSimPipes(gpu.device, grid);
    this.probe = new VillageWaterProbe(gpu.device, this.sim);
    this.topDown = new TopDownProjectorRenderer(gpu, this.sim);
    this.topDown.setStyle(this.style);
  }

  get renderStyle(): Readonly<RenderStyle> {
    return this.style;
  }

  setStyle(patch: Partial<RenderStyle>): void {
    this.style = { ...this.style, ...patch };
    this.topDown.setStyle(patch);
    this.perspective?.setStyle(patch);
  }

  setVillages(markers: VillageMarker[]): void {
    this.villages = markers;
    this.topDown.setVillages(markers);
    this.perspective?.setVillages(markers);
  }

  setProbes(probes: WaterProbe[]): void {
    this.probe.setProbes(probes);
    this.probeCount = probes.length;
  }

  /** Last completed probe readback (max water depth per village), or null while none has landed. */
  probeValues(): Float32Array | null {
    return this.probe.latest();
  }

  setOpenEdges(openEdges: EdgeFlags): void {
    this.sim.setParams({ openEdges });
  }

  /** Encodes sim steps, probes and the view into one command buffer, submits it, then starts the probe readback. */
  submitFrame(frame: SceneFrame): void {
    if (this.destroyed) return;
    const device = this.gpu.device;
    const encoder = device.createCommandEncoder({ label: 'livesand-frame' });
    this.sim.encodeSteps(encoder, frame.steps);
    if (this.probeCount > 0) this.probe.encode(encoder);
    if (frame.view) {
      const texture = this.context.getCurrentTexture();
      const target = texture.createView();
      if (frame.view === '3d') {
        const renderer = this.ensurePerspective();
        if (frame.camera) renderer.setCamera(frame.camera.viewProjection(texture.width / texture.height), frame.camera.eye());
        renderer.render(encoder, target, texture.width, texture.height);
      } else {
        this.topDown.render(encoder, target);
      }
    }
    device.queue.submit([encoder.finish()]);
    if (this.probeCount > 0) this.probe.requestReadback();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.perspective?.destroy();
    this.topDown.destroy();
    this.probe.destroy();
    this.sim.destroy();
  }

  private ensurePerspective(): Perspective3DRenderer {
    if (!this.perspective) {
      this.perspective = new Perspective3DRenderer(this.gpu, this.sim);
      this.perspective.setStyle(this.style);
      this.perspective.setVillages(this.villages);
    }
    return this.perspective;
  }
}
