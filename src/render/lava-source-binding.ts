// Lava/rock buffers for a renderer plus the per-frame lava effects field; without lava every slot binds a tiny zero buffer.
import type { GridSize } from '../core/types';
import { LAVA_FX_BYTES_PER_CELL, LAVA_FX_COMPUTE_WGSL, LAVA_FX_WORKGROUP } from './lava-fx-field-shaders';
import { createCheckedShaderModule, type RendererSimSource } from './render-frame-uniforms';

/** Per-cell f32 buffers (index y * width + x): molten lava depth and rock thickness (world units), optional emission (units/s). */
export interface LavaSource {
  lava: GPUBuffer;
  rock: GPUBuffer;
  /** Where lava is being poured right now: fresh lava there glows white-hot. */
  emission?: GPUBuffer;
}

/** What the render bind group needs: the lava source (or fallbacks) and the (glow, steam, slope) field. */
export interface LavaBindings extends LavaSource {
  emission: GPUBuffer;
  fx: GPUBuffer;
}

// Smaller than any grid, so shaders see arrayLength < cells and skip lava work entirely.
const FALLBACK_BYTES = 16;

/** Throws a readable error when a lava source cannot cover the grid or cannot be bound as storage. */
export function assertLavaSourceMatches(grid: GridSize, src: LavaSource): void {
  const bytes = grid.width * grid.height * 4;
  const buffers: [string, GPUBuffer | undefined][] = [['lava', src.lava], ['rock', src.rock]];
  if (src.emission) buffers.push(['emission', src.emission]);
  for (const [name, buffer] of buffers) {
    if (!buffer) throw new Error(`Lava source is missing its ${name} buffer`);
    if (buffer.size < bytes) {
      throw new Error(`Lava source ${name} buffer holds ${buffer.size} bytes; the ${grid.width}x${grid.height} grid needs ${bytes}`);
    }
    if ((buffer.usage & GPUBufferUsage.STORAGE) === 0) throw new Error(`Lava source ${name} buffer lacks STORAGE usage`);
  }
}

interface LavaFxField {
  buffer: GPUBuffer;
  pipeline: GPUComputePipeline;
  bindGroup: GPUBindGroup | null;
}

export class LavaSourceBinding {
  private readonly device: GPUDevice;
  private readonly sim: RendererSimSource;
  private readonly uniform: GPUBuffer;
  private readonly label: string;
  private readonly fallback: GPUBuffer;
  private source: LavaSource | null = null;
  // Built on the first lava source: renderers that never see lava pay nothing.
  private fx: LavaFxField | null = null;

  /** `uniform` is the renderer's frame uniform buffer (grid size + sea level feed the effects pass). */
  constructor(device: GPUDevice, sim: RendererSimSource, uniform: GPUBuffer, label: string) {
    this.device = device;
    this.sim = sim;
    this.uniform = uniform;
    this.label = label;
    // WebGPU zero-initialises new buffers, so no upload is needed.
    this.fallback = device.createBuffer({ label: `${label} no-lava fallback`, size: FALLBACK_BYTES, usage: GPUBufferUsage.STORAGE });
  }

  /** true while a real lava source is bound (renderers skip lava-only passes otherwise). */
  get active(): boolean {
    return this.source !== null;
  }

  get buffers(): LavaBindings {
    const fx = this.source && this.fx ? this.fx.buffer : this.fallback;
    const src = this.source;
    return src ? { lava: src.lava, rock: src.rock, emission: src.emission ?? this.fallback, fx } : { lava: this.fallback, rock: this.fallback, emission: this.fallback, fx };
  }

  /** Validates before storing, so a bad source never replaces a working one. */
  set(src: LavaSource | null): void {
    if (src) assertLavaSourceMatches(this.sim.grid, src);
    this.source = src ? { lava: src.lava, rock: src.rock, emission: src.emission } : null;
    if (!src) return;
    const fx = this.fx ?? this.createFxField();
    this.fx = fx;
    fx.bindGroup = this.device.createBindGroup({
      label: `${this.label} lava fx bind group`,
      layout: fx.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 1, resource: { buffer: this.sim.buffers.terrain } },
        { binding: 2, resource: { buffer: this.sim.buffers.water } },
        { binding: 5, resource: { buffer: src.lava } },
        { binding: 7, resource: { buffer: fx.buffer } },
      ],
    });
  }

  /** Recomputes the (glow, steam, slope) field; call after the frame uniforms are written and before the render pass. */
  encodeEffects(encoder: GPUCommandEncoder): void {
    if (!this.source || !this.fx?.bindGroup) return;
    const pass = encoder.beginComputePass({ label: `${this.label} lava fx pass` });
    pass.setPipeline(this.fx.pipeline);
    pass.setBindGroup(0, this.fx.bindGroup);
    const { width, height } = this.sim.grid;
    pass.dispatchWorkgroups(Math.ceil(width / LAVA_FX_WORKGROUP), Math.ceil(height / LAVA_FX_WORKGROUP));
    pass.end();
  }

  destroy(): void {
    this.source = null;
    this.fallback.destroy();
    this.fx?.buffer.destroy();
    this.fx = null;
  }

  private createFxField(): LavaFxField {
    const { width, height } = this.sim.grid;
    const buffer = this.device.createBuffer({ label: `${this.label} lava fx field`, size: width * height * LAVA_FX_BYTES_PER_CELL, usage: GPUBufferUsage.STORAGE });
    const module = createCheckedShaderModule(this.device, `${this.label} lava fx shader`, LAVA_FX_COMPUTE_WGSL);
    const pipeline = this.device.createComputePipeline({ label: `${this.label} lava fx pipeline`, layout: 'auto', compute: { module, entryPoint: 'computeLavaFx' } });
    return { buffer, pipeline, bindGroup: null };
  }
}
