// Virtual-pipes shallow-water simulation (Mei et al. 2007) on GPU storage buffers shared with renderers and probes.
import type { GridSize, SimGpuBuffers } from '../core/types';
import { DEFAULT_WATER_SIM_PARAMS, mergeWaterSimParams, sanitizeField, type WaterSimParams } from './water-sim-params-validation';
import { DEPTH_SHADER_WGSL, FLUX_SHADER_WGSL, SIM_PARAMS_BYTES, SIM_WORKGROUP_SIZE, packSimParams } from './water-sim-shaders';

export type { WaterSimParams } from './water-sim-params-validation';

export class WaterSimPipes {
  readonly grid: GridSize;
  readonly buffers: SimGpuBuffers;
  private readonly device: GPUDevice;
  private readonly cellCount: number;
  private readonly groupsX: number;
  private readonly groupsY: number;
  private readonly paramsBuffer: GPUBuffer;
  private readonly fluxPipeline: GPUComputePipeline;
  private readonly depthPipeline: GPUComputePipeline;
  private readonly bindGroup: GPUBindGroup;
  private current: WaterSimParams;
  private destroyed = false;
  private warnedNonFinite = false;

  constructor(device: GPUDevice, grid: GridSize, params: Partial<WaterSimParams> = {}) {
    const { width, height } = grid;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError(`WaterSimPipes: grid must have positive integer size, got ${width}x${height}`);
    }
    this.cellCount = width * height;
    if (this.cellCount * 16 > device.limits.maxStorageBufferBindingSize) {
      throw new RangeError(`WaterSimPipes: grid ${width}x${height} exceeds this GPU's storage buffer limit`);
    }
    this.device = device;
    this.grid = { width, height };
    this.groupsX = Math.ceil(width / SIM_WORKGROUP_SIZE);
    this.groupsY = Math.ceil(height / SIM_WORKGROUP_SIZE);
    this.current = mergeWaterSimParams(DEFAULT_WATER_SIM_PARAMS, params);

    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    const field = (name: string, bytesPerCell: number): GPUBuffer =>
      device.createBuffer({ label: `livesand-sim-${name}`, size: this.cellCount * bytesPerCell, usage });
    this.buffers = {
      terrain: field('terrain', 4),
      water: field('water', 4),
      flux: field('flux', 16),
      emission: field('emission', 4),
      grid: this.grid,
    };
    this.paramsBuffer = device.createBuffer({
      label: 'livesand-sim-params',
      size: SIM_PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // One explicit layout shared by both pipelines lets the bind group stay set across pipeline switches.
    const vis = GPUShaderStage.COMPUTE;
    const layout = device.createBindGroupLayout({
      label: 'livesand-sim-layout',
      entries: [
        { binding: 0, visibility: vis, buffer: { type: 'uniform' } },
        { binding: 1, visibility: vis, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: vis, buffer: { type: 'storage' } },
        { binding: 3, visibility: vis, buffer: { type: 'storage' } },
        { binding: 4, visibility: vis, buffer: { type: 'read-only-storage' } },
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ label: 'livesand-sim-pipeline-layout', bindGroupLayouts: [layout] });
    const pipeline = (label: string, code: string, entryPoint: string): GPUComputePipeline =>
      device.createComputePipeline({
        label,
        layout: pipelineLayout,
        compute: { module: device.createShaderModule({ label, code }), entryPoint },
      });
    this.fluxPipeline = pipeline('livesand-sim-flux', FLUX_SHADER_WGSL, 'fluxMain');
    this.depthPipeline = pipeline('livesand-sim-depth', DEPTH_SHADER_WGSL, 'depthMain');
    const b = this.buffers;
    this.bindGroup = device.createBindGroup({
      label: 'livesand-sim-bind-group',
      layout,
      entries: [this.paramsBuffer, b.terrain, b.water, b.flux, b.emission].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    this.writeParams();
  }

  get params(): WaterSimParams {
    return { ...this.current, openEdges: { ...this.current.openEdges } };
  }

  setParams(patch: Partial<WaterSimParams>): void {
    this.assertAlive();
    this.current = mergeWaterSimParams(this.current, patch);
    this.writeParams();
  }

  uploadTerrain(heights: Float32Array): void {
    this.uploadField(this.buffers.terrain, heights, 'terrain', -Infinity);
  }

  /** Emission in units/s per cell (rain, springs); negative values act as sinks. */
  uploadEmission(ratePerCell: Float32Array): void {
    this.uploadField(this.buffers.emission, ratePerCell, 'emission', -Infinity);
  }

  /** Overwrites depths only; existing flux keeps its momentum (use clearWater() for a full reset). */
  uploadWater(depths: Float32Array): void {
    this.uploadField(this.buffers.water, depths, 'water', 0);
  }

  clearWater(): void {
    this.assertAlive();
    const encoder = this.device.createCommandEncoder({ label: 'livesand-sim-clear' });
    encoder.clearBuffer(this.buffers.water);
    encoder.clearBuffer(this.buffers.flux);
    this.device.queue.submit([encoder.finish()]);
  }

  encodeSteps(encoder: GPUCommandEncoder, steps: number): void {
    this.assertAlive();
    if (!Number.isInteger(steps) || steps < 0) throw new RangeError(`encodeSteps: steps must be a non-negative integer, got ${steps}`);
    if (steps === 0) return;
    // Consecutive dispatches in one pass are ordered, so each depth update sees the flux written just before it.
    const pass = encoder.beginComputePass({ label: 'livesand-sim-steps' });
    pass.setBindGroup(0, this.bindGroup);
    for (let s = 0; s < steps; s++) {
      pass.setPipeline(this.fluxPipeline);
      pass.dispatchWorkgroups(this.groupsX, this.groupsY);
      pass.setPipeline(this.depthPipeline);
      pass.dispatchWorkgroups(this.groupsX, this.groupsY);
    }
    pass.end();
  }

  async readWater(): Promise<Float32Array> {
    this.assertAlive();
    const size = this.cellCount * 4;
    const staging = this.device.createBuffer({
      label: 'livesand-sim-water-readback',
      size,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    try {
      const encoder = this.device.createCommandEncoder({ label: 'livesand-sim-read-water' });
      encoder.copyBufferToBuffer(this.buffers.water, 0, staging, 0, size);
      this.device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      return new Float32Array(staging.getMappedRange().slice(0));
    } finally {
      staging.destroy();
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const b = this.buffers;
    for (const buffer of [b.terrain, b.water, b.flux, b.emission, this.paramsBuffer]) buffer.destroy();
  }

  private writeParams(): void {
    this.device.queue.writeBuffer(this.paramsBuffer, 0, packSimParams(this.grid, this.current));
  }

  private uploadField(target: GPUBuffer, data: Float32Array, name: string, min: number): void {
    this.assertAlive();
    if (data.length !== this.cellCount) {
      throw new RangeError(`WaterSimPipes ${name}: expected ${this.cellCount} values (${this.grid.width}x${this.grid.height}), got ${data.length}`);
    }
    // A single NaN would spread to the whole grid through neighbour exchange, so clean it on the way in.
    const { clean, hadNonFinite } = sanitizeField(data, min);
    if (hadNonFinite && !this.warnedNonFinite) {
      this.warnedNonFinite = true;
      console.warn(`[livesand] non-finite ${name} values replaced with 0`);
    }
    this.device.queue.writeBuffer(target, 0, clean);
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error('WaterSimPipes has been destroyed');
  }
}
