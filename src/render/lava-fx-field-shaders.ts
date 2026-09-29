// WGSL for the per-cell lava effects field (glow, steam, flow slope): a compute pass writes it once per frame, render passes sample it.
import { FRAME_BINDINGS_WGSL, SIM_SAMPLING_WGSL, bilinearSampler } from './sim-sampling-shaders';
import { WATER_SURFACE_WGSL } from './water-surface-shaders';
import { LAVA_SAMPLING_WGSL } from './lava-sampling-shaders';

export const LAVA_FX_WORKGROUP = 8;
/** Bytes per cell of the effects field: vec4<f32> (glow, steam, lava surface slope x, y). */
export const LAVA_FX_BYTES_PER_CELL = 16;

/** Render side: read-only view of the field (binding 7); a fallback smaller than the grid reads as zero. */
export const LAVA_FX_READ_WGSL = /* wgsl */ `
@group(0) @binding(7) var<storage, read> lavaFxBuf: array<vec4<f32>>; // (glow, steam, slope.x, slope.y) per cell

fn lavaFxAt(c: vec2<i32>) -> vec4<f32> {
  let n = arrayLength(&lavaFxBuf);
  let i = cellIndex(c);
  return select(vec4<f32>(0.0), lavaFxBuf[min(i, n - 1u)], i < n);
}
${bilinearSampler('lavaFxBilinear', 'lavaFxAt', 'vec4<f32>')}
`;

/** Compute side: one invocation per cell runs the (expensive) neighbourhood search and the smoothed slope. */
export const LAVA_FX_COMPUTE_WGSL = [
  FRAME_BINDINGS_WGSL,
  SIM_SAMPLING_WGSL,
  WATER_SURFACE_WGSL,
  LAVA_SAMPLING_WGSL,
  /* wgsl */ `
@group(0) @binding(7) var<storage, read_write> lavaFxOut: array<vec4<f32>>;

// Surface slope over a few cells: a per-pixel gradient flips across a flow's convex crown and would shear the crust into streaks.
fn lavaFlowSlope(p: vec2<f32>) -> vec2<f32> {
  var g = vec2<f32>(0.0);
  for (var k = 1; k <= 2; k++) {
    let r = f32(k) * 2.5;
    let dx = terrainBilinear(p + vec2<f32>(r, 0.0)) - terrainBilinear(p - vec2<f32>(r, 0.0));
    let dy = terrainBilinear(p + vec2<f32>(0.0, r)) - terrainBilinear(p - vec2<f32>(0.0, r));
    g += vec2<f32>(dx, dy) / (2.0 * r);
  }
  return g * 0.5;
}

@compute @workgroup_size(${LAVA_FX_WORKGROUP}, ${LAVA_FX_WORKGROUP})
fn computeLavaFx(@builtin(global_invocation_id) id: vec3<u32>) {
  let w = u32(frame.grid.x);
  if (id.x >= w || id.y >= u32(frame.grid.y)) {
    return;
  }
  let p = vec2<f32>(id.xy);
  // Slope only matters under lava; elsewhere skip the extra fetches.
  var slope = vec2<f32>(0.0);
  if (lavaBilinear(p) > 0.01) {
    slope = lavaFlowSlope(p);
  }
  lavaFxOut[id.y * w + id.x] = vec4<f32>(lavaNeighbourhood(p), slope);
}
`,
].join('\n');
