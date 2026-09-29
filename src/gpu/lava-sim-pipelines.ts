// Compute pipelines and the single shared bind group for LavaSim (flow, cooling, steam, terrain compose).
import { LAVA_DEPTH_SHADER_WGSL, LAVA_FLUX_SHADER_WGSL } from './lava-sim-shaders';
import { LAVA_COMPOSE_SHADER_WGSL, LAVA_COOL_SHADER_WGSL, LAVA_STEAM_SHADER_WGSL } from './lava-sim-thermal-shaders';

/** Buffers in WGSL binding order (see LAVA_COMMON_WGSL). */
export interface LavaSimBindings {
  params: GPUBuffer;
  baseTerrain: GPUBuffer;
  rock: GPUBuffer;
  lava: GPUBuffer;
  lavaFlux: GPUBuffer;
  lavaEmission: GPUBuffer;
  water: GPUBuffer;
  terrain: GPUBuffer;
}

export interface LavaSimPipelines {
  flux: GPUComputePipeline;
  depth: GPUComputePipeline;
  cool: GPUComputePipeline;
  steam: GPUComputePipeline;
  compose: GPUComputePipeline;
  bindGroup: GPUBindGroup;
}

export function createLavaSimPipelines(device: GPUDevice, b: LavaSimBindings): LavaSimPipelines {
  // One explicit layout shared by every pipeline lets the bind group stay set across pipeline switches.
  const vis = GPUShaderStage.COMPUTE;
  const read: GPUBufferBindingLayout = { type: 'read-only-storage' };
  const write: GPUBufferBindingLayout = { type: 'storage' };
  const kinds: GPUBufferBindingLayout[] = [{ type: 'uniform' }, read, write, write, write, read, write, write];
  const layout = device.createBindGroupLayout({
    label: 'livesand-lava-layout',
    entries: kinds.map((buffer, binding) => ({ binding, visibility: vis, buffer })),
  });
  const pipelineLayout = device.createPipelineLayout({ label: 'livesand-lava-pipeline-layout', bindGroupLayouts: [layout] });
  const pipeline = (label: string, code: string, entryPoint: string): GPUComputePipeline =>
    device.createComputePipeline({
      label,
      layout: pipelineLayout,
      compute: { module: device.createShaderModule({ label, code }), entryPoint },
    });
  const ordered = [b.params, b.baseTerrain, b.rock, b.lava, b.lavaFlux, b.lavaEmission, b.water, b.terrain];
  return {
    flux: pipeline('livesand-lava-flux', LAVA_FLUX_SHADER_WGSL, 'fluxMain'),
    depth: pipeline('livesand-lava-depth', LAVA_DEPTH_SHADER_WGSL, 'depthMain'),
    cool: pipeline('livesand-lava-cool', LAVA_COOL_SHADER_WGSL, 'coolMain'),
    steam: pipeline('livesand-lava-steam', LAVA_STEAM_SHADER_WGSL, 'steamMain'),
    compose: pipeline('livesand-lava-compose', LAVA_COMPOSE_SHADER_WGSL, 'composeMain'),
    bindGroup: device.createBindGroup({
      label: 'livesand-lava-bind-group',
      layout,
      entries: ordered.map((buffer, binding) => ({ binding, resource: { buffer } })),
    }),
  };
}
