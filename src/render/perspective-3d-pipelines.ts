// Render pipelines for the 3D view; all share one bind group layout, 4x MSAA and a depth24plus buffer.
import { PERSPECTIVE_3D_WGSL } from './perspective-3d-shaders';
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

export function createPerspective3DPipelines(
  device: GPUDevice,
  format: GPUTextureFormat,
  bindLayout: GPUBindGroupLayout,
): Perspective3DPipelines {
  const module = createCheckedShaderModule(device, 'perspective 3d shader', PERSPECTIVE_3D_WGSL);
  const layout = device.createPipelineLayout({ label: 'perspective 3d layout', bindGroupLayouts: [bindLayout] });
  const multisample: GPUMultisampleState = { count: MSAA_SAMPLES };
  // Cull none: skirts and houses are built without caring about winding and are cheap to shade.
  const primitive: GPUPrimitiveState = { topology: 'triangle-list', cullMode: 'none' };
  const opaqueDepth: GPUDepthStencilState = { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' };

  const sky = device.createRenderPipeline({
    label: 'perspective sky pipeline',
    layout,
    vertex: { module, entryPoint: 'vsSky' },
    fragment: { module, entryPoint: 'fsSky', targets: [{ format }] },
    primitive,
    depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'always' },
    multisample,
  });

  const terrain = device.createRenderPipeline({
    label: 'perspective terrain pipeline',
    layout,
    vertex: { module, entryPoint: 'vsTerrain' },
    fragment: { module, entryPoint: 'fsTerrain', targets: [{ format }] },
    primitive,
    depthStencil: opaqueDepth,
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

  const water = device.createRenderPipeline({
    label: 'perspective water pipeline',
    layout,
    vertex: { module, entryPoint: 'vsWater' },
    fragment: {
      module,
      entryPoint: 'fsWater',
      targets: [
        {
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        },
      ],
    },
    primitive,
    // Test against terrain but don't write: overlapping ripples must not punch holes in each other.
    depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'less' },
    multisample,
  });

  return { sky, terrain, houses, water };
}
