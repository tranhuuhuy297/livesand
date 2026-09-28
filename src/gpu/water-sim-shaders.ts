// WGSL for the virtual-pipes shallow-water model plus the CPU packing of its uniform block (kept together so layouts match).
import type { EdgeFlags, GridSize } from '../core/types';
import type { WaterSimParams } from './water-sim-params-validation';

export const SIM_WORKGROUP_SIZE = 8;

/** Byte size of the SimParams uniform below (8 x 4-byte scalars). */
export const SIM_PARAMS_BYTES = 32;

export const EDGE_BIT_NORTH = 1;
export const EDGE_BIT_EAST = 2;
export const EDGE_BIT_SOUTH = 4;
export const EDGE_BIT_WEST = 8;

export function edgeMask(edges: EdgeFlags): number {
  return (
    (edges.north ? EDGE_BIT_NORTH : 0) |
    (edges.east ? EDGE_BIT_EAST : 0) |
    (edges.south ? EDGE_BIT_SOUTH : 0) |
    (edges.west ? EDGE_BIT_WEST : 0)
  );
}

/** Packs params in the exact field order of the WGSL `SimParams` struct. */
export function packSimParams(grid: GridSize, p: WaterSimParams): ArrayBuffer {
  const buf = new ArrayBuffer(SIM_PARAMS_BYTES);
  const u32 = new Uint32Array(buf);
  const f32 = new Float32Array(buf);
  u32[0] = grid.width;
  u32[1] = grid.height;
  f32[2] = p.dt;
  f32[3] = p.gravity;
  f32[4] = p.damping;
  f32[5] = p.evaporationPerSec;
  u32[6] = edgeMask(p.openEdges);
  u32[7] = 0;
  return buf;
}

// Both entry points share one bind group layout, so every binding is declared identically in each module.
const SIM_COMMON_WGSL = /* wgsl */ `
struct SimParams {
  width: u32,
  height: u32,
  dt: f32,
  gravity: f32,
  damping: f32,
  evaporation: f32,
  openMask: u32,
  pad0: u32,
}

@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read> terrain: array<f32>;
@group(0) @binding(2) var<storage, read_write> water: array<f32>;
@group(0) @binding(3) var<storage, read_write> flux: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> emission: array<f32>;

const OPEN_NORTH: u32 = ${EDGE_BIT_NORTH}u;
const OPEN_EAST: u32 = ${EDGE_BIT_EAST}u;
const OPEN_SOUTH: u32 = ${EDGE_BIT_SOUTH}u;
const OPEN_WEST: u32 = ${EDGE_BIT_WEST}u;
`;

/** Pass 1: per-cell outflow update (in place; only reads neighbour heads, which this pass never writes). */
export const FLUX_SHADER_WGSL = /* wgsl */ `${SIM_COMMON_WGSL}
fn headAt(i: u32) -> f32 {
  return terrain[i] + water[i];
}

// Pipe cross-section / length = 1, so acceleration is g * head difference.
fn pipe(prev: f32, dh: f32) -> f32 {
  return max(0.0, params.damping * prev + params.dt * params.gravity * dh);
}

fn isOpen(bit: u32) -> bool {
  return (params.openMask & bit) != 0u;
}

@compute @workgroup_size(${SIM_WORKGROUP_SIZE}, ${SIM_WORKGROUP_SIZE})
fn fluxMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = params.width;
  let h = params.height;
  if (gid.x >= w || gid.y >= h) {
    return;
  }
  let x = gid.x;
  let y = gid.y;
  let i = y * w + x;
  let d = water[i];
  let hc = terrain[i] + d;
  // Outside an open edge sits an empty cell at this cell's terrain level, so the head drop is just the depth.
  let edgeDrop = d;
  let f = flux[i];
  var o = vec4<f32>(0.0);

  if (x > 0u) { o.x = pipe(f.x, hc - headAt(i - 1u)); } else if (isOpen(OPEN_WEST)) { o.x = pipe(f.x, edgeDrop); }
  if (x + 1u < w) { o.y = pipe(f.y, hc - headAt(i + 1u)); } else if (isOpen(OPEN_EAST)) { o.y = pipe(f.y, edgeDrop); }
  if (y > 0u) { o.z = pipe(f.z, hc - headAt(i - w)); } else if (isOpen(OPEN_NORTH)) { o.z = pipe(f.z, edgeDrop); }
  if (y + 1u < h) { o.w = pipe(f.w, hc - headAt(i + w)); } else if (isOpen(OPEN_SOUTH)) { o.w = pipe(f.w, edgeDrop); }

  // Scale so a cell never ships out more water than it holds this step (keeps depth non-negative).
  let total = o.x + o.y + o.z + o.w;
  var k = 1.0;
  if (total * params.dt > d) {
    k = d / (total * params.dt);
  }
  flux[i] = o * k;
}
`;

/** Pass 2: depth update from net flux, emission and evaporation (in place; flux is read-only here). */
export const DEPTH_SHADER_WGSL = /* wgsl */ `${SIM_COMMON_WGSL}
@compute @workgroup_size(${SIM_WORKGROUP_SIZE}, ${SIM_WORKGROUP_SIZE})
fn depthMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = params.width;
  let h = params.height;
  if (gid.x >= w || gid.y >= h) {
    return;
  }
  let x = gid.x;
  let y = gid.y;
  let i = y * w + x;
  let f = flux[i];

  var inflow = 0.0;
  if (x > 0u) { inflow += flux[i - 1u].y; }
  if (x + 1u < w) { inflow += flux[i + 1u].x; }
  if (y > 0u) { inflow += flux[i - w].w; }
  if (y + 1u < h) { inflow += flux[i + w].z; }
  // Flux through open edges is included in the outflow but has no receiver: that water drains away.
  let outflow = f.x + f.y + f.z + f.w;

  var d = water[i] + params.dt * (inflow - outflow + emission[i]);
  d = d * max(0.0, 1.0 - params.evaporation * params.dt);
  water[i] = max(d, 0.0);
}
`;
