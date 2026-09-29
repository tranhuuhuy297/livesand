// Render pipelines for the 3D view; all share one bind group layout, 4x MSAA and a depth24plus buffer.
import { perspective3DWgsl } from './perspective-3d-shaders';
import { HOUSE_VERTEX_FLOATS } from './heightfield-mesh-geometry';
import { createCheckedShaderModule } from './render-frame-uniforms';

export const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';
export const MSAA_SAMPLES = 4;

export interface Perspective3DPipelines {
  sky: GPURenderPipeline;
  terrain: GPURenderPipeline;
  houses: GPURenderPipeline;
  water: GPURenderPipeline;
}

/** Lava variants: terrain and water with molten/rock/steam shading, plus the steam puff and glow sprites. */
export interface PerspectiveLavaPipelines {
  terrain: GPURenderPipeline;
  water: GPURenderPipeline;
  steam: GPURenderPipeline;
}

interface PipelineContext {
  device: GPUDevice;
  format: GPUTextureFormat;
  layout: GPUPipelineLayout;
  module: GPUShaderModule;
}

const multisample: GPUMultisampleState = { count: MSAA_SAMPLES };
// Cull none: skirts and houses are built without caring about winding and are cheap to shade.
const primitive: GPUPrimitiveState = { topology: 'triangle-list', cullMode: 'none' };
const opaqueDepth: GPUDepthStencilState = { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' };
// Test against terrain but don't write: overlapping ripples or puffs must not punch holes in each other.
const overlayDepth: GPUDepthStencilState = { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'less' };

function pipelineContext(device: GPUDevice, format: GPUTextureFormat, bindLayout: GPUBindGroupLayout, lava: boolean): PipelineContext {
  const label = lava ? 'perspective 3d lava' : 'perspective 3d';
  const module = createCheckedShaderModule(device, `${label} shader`, perspective3DWgsl(lava));
  const layout = device.createPipelineLayout({ label: `${label} layout`, bindGroupLayouts: [bindLayout] });
  return { device, format, layout, module };
}

function terrainPipeline(ctx: PipelineContext, label: string): GPURenderPipeline {
  const { device, format, layout, module } = ctx;
  return device.createRenderPipeline({
    label,
    layout,
    vertex: { module, entryPoint: 'vsTerrain' },
    fragment: { module, entryPoint: 'fsTerrain', targets: [{ format }] },
    primitive,
    depthStencil: opaqueDepth,
    multisample,
  });
}

// Blends a transparent overlay (water: straight alpha; steam: premultiplied, where zero alpha adds light).
function overlayPipeline(ctx: PipelineContext, label: string, entry: 'Water' | 'Steam'): GPURenderPipeline {
  const { device, format, layout, module } = ctx;
  const srcFactor: GPUBlendFactor = entry === 'Water' ? 'src-alpha' : 'one';
  return device.createRenderPipeline({
    label,
    layout,
    vertex: { module, entryPoint: `vs${entry}` },
    fragment: {
      module,
      entryPoint: `fs${entry}`,
      targets: [
        {
          format,
          blend: {
            color: { srcFactor, dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        },
      ],
    },
    primitive,
    depthStencil: overlayDepth,
    multisample,
  });
}

/** Lava-free pipelines, built up front. */
export function createPerspective3DPipelines(
  device: GPUDevice,
  format: GPUTextureFormat,
  bindLayout: GPUBindGroupLayout,
): Perspective3DPipelines {
  const ctx = pipelineContext(device, format, bindLayout, false);
  const { layout, module } = ctx;

  const sky = device.createRenderPipeline({
    label: 'perspective sky pipeline',
    layout,
    vertex: { module, entryPoint: 'vsSky' },
    fragment: { module, entryPoint: 'fsSky', targets: [{ format }] },
    primitive,
    depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'always' },
    multisample,
  });

  const houses = device.createRenderPipeline({
    label: 'perspective houses pipeline',
    layout,
    vertex: {
      module,
      entryPoint: 'vsHouse',
      buffers: [
        {
          arrayStride: HOUSE_VERTEX_FLOATS * 4,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32' },
          ],
        },
      ],
    },
    fragment: { module, entryPoint: 'fsHouse', targets: [{ format }] },
    primitive,
    depthStencil: opaqueDepth,
    multisample,
  });

  const terrain = terrainPipeline(ctx, 'perspective terrain pipeline');
  const water = overlayPipeline(ctx, 'perspective water pipeline', 'Water');
  return { sky, terrain, houses, water };
}

/** Lava pipelines; renderers build them on the first lava source so lava-free sessions never pay their compile time. */
export function createPerspectiveLavaPipelines(
  device: GPUDevice,
  format: GPUTextureFormat,
  bindLayout: GPUBindGroupLayout,
): PerspectiveLavaPipelines {
  const ctx = pipelineContext(device, format, bindLayout, true);
  return {
    terrain: terrainPipeline(ctx, 'perspective lava terrain pipeline'),
    water: overlayPipeline(ctx, 'perspective lava water pipeline', 'Water'),
    steam: overlayPipeline(ctx, 'perspective steam pipeline', 'Steam'),
  };
}
