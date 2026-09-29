// Viscous lava on GPU virtual pipes: flows over base terrain + rock, cools into rock, quenches and boils water it touches.
import type { GridSize, SimGpuBuffers } from '../core/types';
import { DEFAULT_LAVA_SIM_PARAMS, mergeLavaSimParams, type LavaSimParams } from './lava-sim-params';
import { createLavaSimPipelines, type LavaSimPipelines } from './lava-sim-pipelines';
import { readStorageBufferF32 } from './lava-sim-readback';
import { LAVA_PARAMS_BYTES, LAVA_WORKGROUP_SIZE, packLavaParams } from './lava-sim-shaders';
import { sanitizeField } from './water-sim-params-validation';

export type { LavaSimParams } from './lava-sim-params';

/** f32 per cell (lavaFlux: vec4 left/right/north/south outflow), index = y * width + x. */
export interface LavaGpuBuffers {
  lava: GPUBuffer;
  lavaFlux: GPUBuffer;
  rock: GPUBuffer;
  baseTerrain: GPUBuffer;
  lavaEmission: GPUBuffer;
}

export class LavaSim {
  readonly grid: GridSize;
  readonly buffers: LavaGpuBuffers;
  private readonly device: GPUDevice;
  private readonly cellCount: number;
  private readonly groupsX: number;
  private readonly groupsY: number;
  private readonly paramsBuffer: GPUBuffer;
  private readonly pipelines: LavaSimPipelines;
  private current: LavaSimParams;
  private destroyed = false;
  private warnedNonFinite = false;

  /** Starts with the water sim's current terrain as base; from then on encodeSteps owns `water.buffers.terrain`. */
  constructor(device: GPUDevice, water: { readonly grid: GridSize; readonly buffers: SimGpuBuffers }, params: Partial<LavaSimParams> = {}) {
    const { width, height } = water.grid;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError(`LavaSim: grid must have positive integer size, got ${width}x${height}`);
    }
    this.cellCount = width * height;
    const fieldBytes = this.cellCount * 4;
    if (fieldBytes * 4 > device.limits.maxStorageBufferBindingSize) {
      throw new RangeError(`LavaSim: grid ${width}x${height} exceeds this GPU's storage buffer limit`);
    }
    if (water.buffers.terrain.size < fieldBytes || water.buffers.water.size < fieldBytes) {
      throw new RangeError(`LavaSim: water sim buffers are smaller than the ${width}x${height} grid`);
    }
    this.current = mergeLavaSimParams(DEFAULT_LAVA_SIM_PARAMS, params);
    this.device = device;
    this.grid = { width, height };
    this.groupsX = Math.ceil(width / LAVA_WORKGROUP_SIZE);
    this.groupsY = Math.ceil(height / LAVA_WORKGROUP_SIZE);

    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    const field = (name: string, bytesPerCell: number): GPUBuffer =>
      device.createBuffer({ label: `livesand-lava-${name}`, size: this.cellCount * bytesPerCell, usage });
    this.buffers = {
      lava: field('lava', 4),
      lavaFlux: field('flux', 16),
      rock: field('rock', 4),
      baseTerrain: field('base-terrain', 4),
      lavaEmission: field('emission', 4),
    };
    this.paramsBuffer = device.createBuffer({
      label: 'livesand-lava-params',
      size: LAVA_PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const b = this.buffers;
    this.pipelines = createLavaSimPipelines(device, {
      params: this.paramsBuffer,
      baseTerrain: b.baseTerrain,
      rock: b.rock,
      lava: b.lava,
      lavaFlux: b.lavaFlux,
      lavaEmission: b.lavaEmission,
      water: water.buffers.water,
      terrain: water.buffers.terrain,
    });
    this.writeParams();
    // Copying the current ground means adding lava to a running sandbox never flattens terrain uploaded earlier.
    const encoder = device.createCommandEncoder({ label: 'livesand-lava-init' });
    encoder.copyBufferToBuffer(water.buffers.terrain, 0, b.baseTerrain, 0, fieldBytes);
    device.queue.submit([encoder.finish()]);
  }

  get params(): LavaSimParams {
    return { ...this.current, openEdges: { ...this.current.openEdges } };
  }

  setParams(patch: Partial<LavaSimParams>): void {
    this.assertAlive();
    this.current = mergeLavaSimParams(this.current, patch);
    this.writeParams();
  }

  /** CPU-sculpted ground without rock/lava; reaches the water terrain on the next encodeSteps (even with 0 steps). */
  uploadBaseTerrain(heights: Float32Array): void {
    this.uploadField(this.buffers.baseTerrain, heights, 'baseTerrain', -Infinity);
  }

  /** Crater emission in units/s per cell. */
  uploadLavaEmission(ratePerCell: Float32Array): void {
    this.uploadField(this.buffers.lavaEmission, ratePerCell, 'lavaEmission', 0);
  }

  /** Overwrites depths only; existing flux keeps its momentum (use clear() for a full reset). */
  uploadLava(depths: Float32Array): void {
    this.uploadField(this.buffers.lava, depths, 'lava', 0);
  }

  /** Zeroes lava, flux and rock, and restores the water terrain to the bare base terrain right away. */
  clear(): void {
    this.assertAlive();
    const encoder = this.device.createCommandEncoder({ label: 'livesand-lava-clear' });
    encoder.clearBuffer(this.buffers.lava);
    encoder.clearBuffer(this.buffers.lavaFlux);
    encoder.clearBuffer(this.buffers.rock);
    this.encodeSteps(encoder, 0);
    this.device.queue.submit([encoder.finish()]);
  }

  /** Each step: flux -> depth (+emission) -> cooling/quench -> steam; always ends by writing base + rock + lava terrain. */
  encodeSteps(encoder: GPUCommandEncoder, steps: number): void {
    this.assertAlive();
    if (!Number.isInteger(steps) || steps < 0) throw new RangeError(`encodeSteps: steps must be a non-negative integer, got ${steps}`);
    const p = this.pipelines;
    // Consecutive dispatches in one pass are ordered, so each pass sees the fields written just before it.
    const pass = encoder.beginComputePass({ label: 'livesand-lava-steps' });
    pass.setBindGroup(0, p.bindGroup);
    const dispatch = (pipeline: GPUComputePipeline): void => {
      pass.setPipeline(pipeline);
      pass.dispatchWorkgroups(this.groupsX, this.groupsY);
    };
    for (let s = 0; s < steps; s++) {
      dispatch(p.flux);
      dispatch(p.depth);
      dispatch(p.cool);
      dispatch(p.steam);
    }
    dispatch(p.compose);
    pass.end();
  }

  readLava(): Promise<Float32Array> {
    this.assertAlive();
    return readStorageBufferF32(this.device, this.buffers.lava, this.cellCount, 'livesand-lava-read-lava');
  }

  readRock(): Promise<Float32Array> {
    this.assertAlive();
    return readStorageBufferF32(this.device, this.buffers.rock, this.cellCount, 'livesand-lava-read-rock');
  }

  /** Frees lava-owned buffers only; the water sim's terrain/water buffers stay alive. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const b = this.buffers;
    for (const buffer of [b.lava, b.lavaFlux, b.rock, b.baseTerrain, b.lavaEmission, this.paramsBuffer]) buffer.destroy();
  }

  private writeParams(): void {
    this.device.queue.writeBuffer(this.paramsBuffer, 0, packLavaParams(this.grid, this.current));
  }

  private uploadField(target: GPUBuffer, data: Float32Array, name: string, min: number): void {
    this.assertAlive();
    if (data.length !== this.cellCount) {
      throw new RangeError(`LavaSim ${name}: expected ${this.cellCount} values (${this.grid.width}x${this.grid.height}), got ${data.length}`);
    }
    // A single NaN would spread to the whole grid through neighbour exchange, so clean it on the way in.
    const { clean, hadNonFinite } = sanitizeField(data, min);
    if (hadNonFinite && !this.warnedNonFinite) {
      this.warnedNonFinite = true;
      console.warn(`[livesand] non-finite lava ${name} values replaced with 0`);
    }
    this.device.queue.writeBuffer(target, 0, clean);
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error('LavaSim has been destroyed');
  }
}
