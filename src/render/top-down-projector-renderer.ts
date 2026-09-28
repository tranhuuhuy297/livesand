// Projector / map view: a single full-screen pass shading terrain, water and villages straight from the sim buffers.
import type { VillageMarker } from '../core/types';
import { DEFAULT_RENDER_STYLE, mergeRenderStyle, type RenderStyle } from './shading-common-wgsl';
import { TOP_DOWN_PROJECTOR_WGSL } from './top-down-projector-shaders';
import {
  FRAME_UNIFORM_BYTES,
  FRAME_UNIFORM_FLOATS,
  assertGridMatches,
  createCheckedShaderModule,
  createFrameBindGroup,
  createFrameBindGroupLayout,
  packFrameUniforms,
  sanitizeSources,
  sanitizeVillages,
  type SourceMarker,
  type RendererGpu,
  type RendererSimSource,
} from './render-frame-uniforms';

export class TopDownProjectorRenderer {
  private readonly device: GPUDevice;
  private readonly sim: RendererSimSource;
  private readonly uniformBuffer: GPUBuffer;
  private readonly uniformData = new Float32Array(FRAME_UNIFORM_FLOATS);
  private readonly bindGroup: GPUBindGroup;
  private readonly pipeline: GPURenderPipeline;
  private style: RenderStyle = { ...DEFAULT_RENDER_STYLE };
  private villages: VillageMarker[] = [];
  private sources: SourceMarker[] = [];
  private destroyed = false;

  constructor(gpu: RendererGpu, sim: RendererSimSource) {
    assertGridMatches(sim);
    this.device = gpu.device;
    this.sim = sim;
    this.uniformBuffer = this.device.createBuffer({
      label: 'top-down frame uniforms',
      size: FRAME_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const layout = createFrameBindGroupLayout(this.device, 'top-down bind layout');
    this.bindGroup = createFrameBindGroup(this.device, layout, this.uniformBuffer, sim.buffers, 'top-down bind group');
    const module = createCheckedShaderModule(this.device, 'top-down projector shader', TOP_DOWN_PROJECTOR_WGSL);
    this.pipeline = this.device.createRenderPipeline({
      label: 'top-down projector pipeline',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'vsTopDown' },
      fragment: { module, entryPoint: 'fsTopDown', targets: [{ format: gpu.format }] },
      primitive: { topology: 'triangle-list' },
    });
  }

  setStyle(patch: Partial<RenderStyle>): void {
    this.style = mergeRenderStyle(this.style, patch);
  }

  setVillages(markers: VillageMarker[]): void {
    this.villages = sanitizeVillages(markers);
  }

  setSources(markers: readonly SourceMarker[]): void {
    this.sources = sanitizeSources(markers);
  }

  /** `rotated` turns the map a quarter (north to the right) so portrait screens get a taller map. */
  render(encoder: GPUCommandEncoder, target: GPUTextureView, rotated = false): void {
    if (this.destroyed) throw new Error('TopDownProjectorRenderer.render called after destroy()');
    packFrameUniforms(this.uniformData, this.sim.grid, this.style, this.villages, null, { sources: this.sources, rotated });
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
    const pass = encoder.beginRenderPass({
      label: 'top-down projector pass',
      colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.uniformBuffer.destroy();
  }
}
