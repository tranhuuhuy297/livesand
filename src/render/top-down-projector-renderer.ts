// Projector / map view: a single full-screen pass shading terrain, water and villages straight from the sim buffers.
import type { VillageMarker } from '../core/types';
import { DEFAULT_RENDER_STYLE, mergeRenderStyle, type RenderStyle } from './shading-common-wgsl';
import { topDownProjectorWgsl } from './top-down-projector-shaders';
import { LavaSourceBinding, type LavaSource } from './lava-source-binding';
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
  private readonly layout: GPUBindGroupLayout;
  private readonly lava: LavaSourceBinding;
  private bindGroup: GPUBindGroup;
  private readonly format: GPUTextureFormat;
  private readonly pipeline: GPURenderPipeline;
  private lavaPipeline: GPURenderPipeline | null = null;
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
    this.layout = createFrameBindGroupLayout(this.device, 'top-down bind layout');
    this.lava = new LavaSourceBinding(this.device, sim, this.uniformBuffer, 'top-down');
    this.bindGroup = this.createBindGroup();
    this.format = gpu.format;
    this.pipeline = this.createPipeline(false);
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

  /** Lava depth + rock thickness per cell (terrain already includes both); null binds zero buffers = no lava. */
  setLavaSource(src: LavaSource | null): void {
    if (this.destroyed) return;
    this.lava.set(src);
    // Built on the first lava source: lava-free sessions never pay the lava shader's compile time.
    if (src) this.lavaPipeline ??= this.createPipeline(true);
    this.bindGroup = this.createBindGroup();
  }

  /** `rotated` turns the map a quarter (north to the right) so portrait screens get a taller map. */
  render(encoder: GPUCommandEncoder, target: GPUTextureView, rotated = false): void {
    if (this.destroyed) throw new Error('TopDownProjectorRenderer.render called after destroy()');
    packFrameUniforms(this.uniformData, this.sim.grid, this.style, this.villages, null, { sources: this.sources, rotated });
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
    this.lava.encodeEffects(encoder);
    const pass = encoder.beginRenderPass({
      label: 'top-down projector pass',
      colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    pass.setPipeline(this.lava.active && this.lavaPipeline ? this.lavaPipeline : this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.uniformBuffer.destroy();
    this.lava.destroy();
  }

  private createBindGroup(): GPUBindGroup {
    return createFrameBindGroup(this.device, this.layout, this.uniformBuffer, this.sim.buffers, this.lava.buffers, 'top-down bind group');
  }

  private createPipeline(lava: boolean): GPURenderPipeline {
    const label = lava ? 'top-down projector lava' : 'top-down projector';
    const module = createCheckedShaderModule(this.device, `${label} shader`, topDownProjectorWgsl(lava));
    return this.device.createRenderPipeline({
      label: `${label} pipeline`,
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
      vertex: { module, entryPoint: 'vsTopDown' },
      fragment: { module, entryPoint: 'fsTopDown', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
  }
}
