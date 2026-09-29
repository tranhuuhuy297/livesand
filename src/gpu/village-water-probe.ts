// GPU max-water-depth probes for villages, read back asynchronously so the frame loop never waits on the GPU.
import type { GridSize } from '../core/types';
import { PROBE_PARAMS_BYTES, PROBE_RECORD_BYTES, PROBE_SHADER_WGSL } from './village-water-probe-shaders';

export interface WaterProbe {
  x: number;
  y: number;
  radius: number;
}

/** Any per-cell f32 depth field (the water sim, or lava depths passed as `water`). */
export interface ProbedDepthField {
  readonly grid: GridSize;
  readonly buffers: { readonly water: GPUBuffer };
}

type ReadbackState = 'idle' | 'encoded' | 'mapping';

export class VillageWaterProbe {
  private readonly device: GPUDevice;
  private readonly maxProbes: number;
  private readonly paramsBuffer: GPUBuffer;
  private readonly probeBuffer: GPUBuffer;
  private readonly resultBuffer: GPUBuffer;
  private readonly stagingBuffer: GPUBuffer;
  private readonly pipeline: GPUComputePipeline;
  private readonly bindGroup: GPUBindGroup;
  private readonly width: number;
  private readonly height: number;
  private count = 0;
  // Bumped by setProbes so a readback of the previous probe set is discarded instead of mislabelled.
  private generation = 0;
  private encodedGeneration = -1;
  private encodedCount = 0;
  private state: ReadbackState = 'idle';
  private values: Float32Array | null = null;
  private destroyed = false;

  constructor(device: GPUDevice, sim: ProbedDepthField, maxProbes = 16) {
    if (!Number.isInteger(maxProbes) || maxProbes < 1 || maxProbes > device.limits.maxComputeWorkgroupsPerDimension) {
      throw new RangeError(`VillageWaterProbe: maxProbes must be a positive integer, got ${maxProbes}`);
    }
    this.device = device;
    this.maxProbes = maxProbes;
    this.width = sim.grid.width;
    this.height = sim.grid.height;
    const usage = GPUBufferUsage;
    this.paramsBuffer = device.createBuffer({
      label: 'livesand-probe-params',
      size: PROBE_PARAMS_BYTES,
      usage: usage.UNIFORM | usage.COPY_DST,
    });
    this.probeBuffer = device.createBuffer({
      label: 'livesand-probe-circles',
      size: maxProbes * PROBE_RECORD_BYTES,
      usage: usage.STORAGE | usage.COPY_DST,
    });
    this.resultBuffer = device.createBuffer({
      label: 'livesand-probe-results',
      size: maxProbes * 4,
      usage: usage.STORAGE | usage.COPY_SRC,
    });
    this.stagingBuffer = device.createBuffer({
      label: 'livesand-probe-readback',
      size: maxProbes * 4,
      usage: usage.MAP_READ | usage.COPY_DST,
    });
    this.pipeline = device.createComputePipeline({
      label: 'livesand-probe',
      layout: 'auto',
      compute: { module: device.createShaderModule({ label: 'livesand-probe', code: PROBE_SHADER_WGSL }), entryPoint: 'probeMain' },
    });
    this.bindGroup = device.createBindGroup({
      label: 'livesand-probe-bind-group',
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [this.paramsBuffer, sim.buffers.water, this.probeBuffer, this.resultBuffer].map((buffer, binding) => ({
        binding,
        resource: { buffer },
      })),
    });
    this.writeParams();
  }

  setProbes(probes: WaterProbe[]): void {
    this.assertAlive();
    if (probes.length > this.maxProbes) {
      throw new RangeError(`VillageWaterProbe: ${probes.length} probes exceed the maximum of ${this.maxProbes}`);
    }
    const data = new Float32Array(Math.max(probes.length, 1) * 4);
    probes.forEach((p, i) => {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.radius)) {
        throw new RangeError(`VillageWaterProbe: probe ${i} has non-finite fields`);
      }
      data.set([p.x, p.y, Math.max(p.radius, 0), 0], i * 4);
    });
    this.device.queue.writeBuffer(this.probeBuffer, 0, data);
    this.count = probes.length;
    this.generation++;
    this.values = probes.length === 0 ? new Float32Array(0) : null;
    this.writeParams();
  }

  encode(encoder: GPUCommandEncoder): void {
    this.assertAlive();
    // Copying into the staging buffer while it is mapped (or map-pending) is a validation error, so skip this frame.
    if (this.state === 'mapping' || this.count === 0) return;
    const pass = encoder.beginComputePass({ label: 'livesand-probe' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(this.count);
    pass.end();
    encoder.copyBufferToBuffer(this.resultBuffer, 0, this.stagingBuffer, 0, this.count * 4);
    this.state = 'encoded';
    this.encodedGeneration = this.generation;
    this.encodedCount = this.count;
  }

  requestReadback(): void {
    if (this.destroyed || this.state !== 'encoded') return;
    this.state = 'mapping';
    const generation = this.encodedGeneration;
    const bytes = this.encodedCount * 4;
    this.stagingBuffer.mapAsync(GPUMapMode.READ, 0, bytes).then(
      () => {
        if (this.destroyed) return;
        const result = new Float32Array(this.stagingBuffer.getMappedRange(0, bytes).slice(0));
        this.stagingBuffer.unmap();
        if (generation === this.generation) this.values = result;
        this.state = 'idle';
      },
      (err: unknown) => {
        // Rejection is expected when destroyed mid-flight; anything else is worth surfacing but must not wedge the probe.
        if (this.destroyed) return;
        console.warn('[livesand] village probe readback failed:', err);
        this.state = 'idle';
      },
    );
  }

  latest(): Float32Array | null {
    return this.values;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const b of [this.paramsBuffer, this.probeBuffer, this.resultBuffer, this.stagingBuffer]) b.destroy();
  }

  private writeParams(): void {
    this.device.queue.writeBuffer(this.paramsBuffer, 0, new Uint32Array([this.width, this.height, this.count, 0]));
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error('VillageWaterProbe has been destroyed');
  }
}
