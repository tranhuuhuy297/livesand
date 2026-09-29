// 3D demo view: sky/backdrop, heightfield terrain with box walls, instanced houses, alpha-blended water, lava steam.
import { mat4 } from 'wgpu-matrix';
import type { VillageMarker } from '../core/types';
import { DEFAULT_RENDER_STYLE, mergeRenderStyle, type RenderStyle } from './shading-common-wgsl';
import { OrbitCamera } from './orbit-camera';
import { buildHeightfieldIndices, buildHouseMesh, HOUSE_VERTEX_FLOATS } from './heightfield-mesh-geometry';
import { createPerspective3DPipelines, createPerspectiveLavaPipelines, DEPTH_FORMAT, MSAA_SAMPLES } from './perspective-3d-pipelines';
import type { Perspective3DPipelines, PerspectiveLavaPipelines } from './perspective-3d-pipelines';
import { HOUSES_PER_VILLAGE } from './village-marker-shaders';
import { LavaSourceBinding, type LavaSource } from './lava-source-binding';
import { steamPlumeInstanceCount } from './lava-perspective-shaders';
import {
  FRAME_UNIFORM_BYTES,
  FRAME_UNIFORM_FLOATS,
  assertGridMatches,
  createFrameBindGroup,
  createFrameBindGroupLayout,
  packFrameUniforms,
  sanitizeSources,
  sanitizeVillages,
  type SourceMarker,
  type FrameView,
  type RendererGpu,
  type RendererSimSource,
} from './render-frame-uniforms';

export class Perspective3DRenderer {
  private readonly device: GPUDevice;
  private readonly format: GPUTextureFormat;
  private readonly sim: RendererSimSource;
  private readonly uniformBuffer: GPUBuffer;
  private readonly uniformData = new Float32Array(FRAME_UNIFORM_FLOATS);
  private readonly layout: GPUBindGroupLayout;
  private readonly lava: LavaSourceBinding;
  private bindGroup: GPUBindGroup;
  private readonly pipelines: Perspective3DPipelines;
  private lavaPipelines: PerspectiveLavaPipelines | null = null;
  private readonly terrainIndices: { buffer: GPUBuffer; count: number };
  private readonly waterIndices: { buffer: GPUBuffer; count: number };
  private readonly houseVertices: { buffer: GPUBuffer; count: number };
  private readonly fallbackCamera: OrbitCamera;
  private style: RenderStyle = { ...DEFAULT_RENDER_STYLE };
  private villages: VillageMarker[] = [];
  private sources: SourceMarker[] = [];
  private camera: { viewProj: Float32Array; invViewProj: Float32Array; eye: [number, number, number] } | null = null;
  private attachments: { width: number; height: number; depth: GPUTexture; color: GPUTexture } | null = null;
  private destroyed = false;

  constructor(gpu: RendererGpu, sim: RendererSimSource) {
    assertGridMatches(sim);
    this.device = gpu.device;
    this.format = gpu.format;
    this.sim = sim;
    this.fallbackCamera = new OrbitCamera(sim.grid);
    this.uniformBuffer = this.device.createBuffer({
      label: 'perspective frame uniforms',
      size: FRAME_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.layout = createFrameBindGroupLayout(this.device, 'perspective bind layout');
    this.lava = new LavaSourceBinding(this.device, sim, this.uniformBuffer, 'perspective');
    this.bindGroup = this.createBindGroup();
    this.pipelines = createPerspective3DPipelines(this.device, this.format, this.layout);
    const cells = sim.grid.width * sim.grid.height;
    this.terrainIndices = this.upload('terrain indices', buildHeightfieldIndices(sim.grid, 0).indices, GPUBufferUsage.INDEX);
    this.waterIndices = this.upload('water indices', buildHeightfieldIndices(sim.grid, 2 * cells).indices, GPUBufferUsage.INDEX);
    const house = buildHouseMesh();
    const houseBuffer = this.upload('house vertices', house, GPUBufferUsage.VERTEX).buffer;
    this.houseVertices = { buffer: houseBuffer, count: house.length / HOUSE_VERTEX_FLOATS };
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
    if (src) this.lavaPipelines ??= createPerspectiveLavaPipelines(this.device, this.format, this.layout);
    this.bindGroup = this.createBindGroup();
  }

  setCamera(viewProjection: Float32Array, eye: [number, number, number]): void {
    if (viewProjection.length < 16) throw new Error('setCamera expects a 4x4 column-major matrix');
    const viewProj = new Float32Array(viewProjection.subarray(0, 16));
    const invViewProj = mat4.inverse(viewProj) as Float32Array;
    if (!invViewProj.every(Number.isFinite)) throw new Error('setCamera received a singular view-projection matrix');
    this.camera = { viewProj, invViewProj, eye: [eye[0], eye[1], eye[2]] };
  }

  /** width/height must match the target texture size (MSAA colour + depth are resized to it internally). */
  render(encoder: GPUCommandEncoder, target: GPUTextureView, width: number, height: number): void {
    if (this.destroyed) throw new Error('Perspective3DRenderer.render called after destroy()');
    const w = Math.max(1, Math.floor(width) || 1);
    const h = Math.max(1, Math.floor(height) || 1);
    const { depth, color } = this.ensureAttachments(w, h);
    const extras = { sources: this.sources, rotated: false };
    packFrameUniforms(this.uniformData, this.sim.grid, this.style, this.villages, this.frameView(w, h), extras);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
    this.lava.encodeEffects(encoder);

    const pass = encoder.beginRenderPass({
      label: 'perspective 3d pass',
      colorAttachments: [
        { view: color.createView(), resolveTarget: target, loadOp: 'clear', storeOp: 'discard', clearValue: { r: 0.8, g: 0.87, b: 0.94, a: 1 } },
      ],
      depthStencilAttachment: { view: depth.createView(), depthLoadOp: 'clear', depthClearValue: 1, depthStoreOp: 'discard' },
    });
    const lava = this.lava.active ? this.lavaPipelines : null;
    pass.setBindGroup(0, this.bindGroup);
    pass.setPipeline(this.pipelines.sky);
    pass.draw(3);
    pass.setPipeline(lava?.terrain ?? this.pipelines.terrain);
    pass.setIndexBuffer(this.terrainIndices.buffer, 'uint32');
    pass.drawIndexed(this.terrainIndices.count);
    if (this.villages.length > 0) {
      pass.setPipeline(this.pipelines.houses);
      pass.setVertexBuffer(0, this.houseVertices.buffer);
      pass.draw(this.houseVertices.count, this.villages.length * HOUSES_PER_VILLAGE);
    }
    pass.setPipeline(lava?.water ?? this.pipelines.water);
    pass.setIndexBuffer(this.waterIndices.buffer, 'uint32');
    pass.drawIndexed(this.waterIndices.count);
    if (lava) {
      pass.setPipeline(lava.steam);
      pass.draw(6, steamPlumeInstanceCount(this.sim.grid.width, this.sim.grid.height));
    }
    pass.end();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.uniformBuffer.destroy();
    this.terrainIndices.buffer.destroy();
    this.waterIndices.buffer.destroy();
    this.houseVertices.buffer.destroy();
    this.lava.destroy();
    this.attachments?.depth.destroy();
    this.attachments?.color.destroy();
    this.attachments = null;
  }

  private createBindGroup(): GPUBindGroup {
    return createFrameBindGroup(this.device, this.layout, this.uniformBuffer, this.sim.buffers, this.lava.buffers, 'perspective bind group');
  }

  private frameView(width: number, height: number): FrameView {
    const cam = this.camera ?? this.defaultCamera(width / height);
    const span = Math.max(this.sim.grid.width, this.sim.grid.height);
    const { minHeight, maxHeight, verticalScale } = this.style;
    return {
      viewProj: cam.viewProj,
      invViewProj: cam.invViewProj,
      eye: cam.eye,
      viewportWidth: width,
      viewportHeight: height,
      fogStart: Math.hypot(cam.eye[0], cam.eye[1], cam.eye[2]) * 0.5,
      fogDensity: (0.25 / span) * (1 + 1.4 * this.style.stormLevel + 0.8 * this.style.ashLevel),
      baseY: (minHeight - 0.12 * Math.max(maxHeight - minHeight, 1)) * verticalScale,
    };
  }

  private defaultCamera(aspect: number): { viewProj: Float32Array; invViewProj: Float32Array; eye: [number, number, number] } {
    const viewProj = this.fallbackCamera.viewProjection(aspect);
    return { viewProj, invViewProj: mat4.inverse(viewProj) as Float32Array, eye: this.fallbackCamera.eye() };
  }

  private ensureAttachments(width: number, height: number): { depth: GPUTexture; color: GPUTexture } {
    const current = this.attachments;
    if (current && current.width === width && current.height === height) return current;
    current?.depth.destroy();
    current?.color.destroy();
    const size = { width, height };
    const usage = GPUTextureUsage.RENDER_ATTACHMENT;
    const depth = this.device.createTexture({ label: 'perspective depth', size, format: DEPTH_FORMAT, sampleCount: MSAA_SAMPLES, usage });
    const color = this.device.createTexture({ label: 'perspective msaa color', size, format: this.format, sampleCount: MSAA_SAMPLES, usage });
    this.attachments = { width, height, depth, color };
    return this.attachments;
  }

  private upload(label: string, data: Uint32Array | Float32Array, usage: number): { buffer: GPUBuffer; count: number } {
    const buffer = this.device.createBuffer({ label, size: Math.ceil(data.byteLength / 4) * 4, usage: usage | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(buffer, 0, data);
    return { buffer, count: data.length };
  }
}
