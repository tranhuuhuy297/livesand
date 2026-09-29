// WGSL for the viscous lava flow (virtual pipes with a yield stress) plus the CPU packing of its uniform block.
import type { GridSize } from '../core/types';
import { LAVA_FREEZE_DEPTH, LAVA_WET_DEPTH, LAVA_YIELD_STRENGTH, type LavaSimParams } from './lava-sim-params';
import { EDGE_BIT_EAST, EDGE_BIT_NORTH, EDGE_BIT_SOUTH, EDGE_BIT_WEST, SIM_WORKGROUP_SIZE, edgeMask } from './water-sim-shaders';

export const LAVA_WORKGROUP_SIZE = SIM_WORKGROUP_SIZE;

/** Byte size of the LavaParams uniform below (12 x 4-byte scalars, a multiple of 16). */
export const LAVA_PARAMS_BYTES = 48;

/** Packs params in the exact field order of the WGSL `LavaParams` struct. */
export function packLavaParams(grid: GridSize, p: LavaSimParams): ArrayBuffer {
  const buf = new ArrayBuffer(LAVA_PARAMS_BYTES);
  const u32 = new Uint32Array(buf);
  const f32 = new Float32Array(buf);
  u32[0] = grid.width;
  u32[1] = grid.height;
  f32[2] = p.dt;
  f32[3] = p.gravity;
  f32[4] = p.damping;
  f32[5] = p.coolingPerSec;
  f32[6] = p.quenchPerSec;
  f32[7] = p.steamPerSec;
  u32[8] = edgeMask(p.openEdges);
  f32[9] = p.seaLevel;
  return buf;
}

// All entry points share one bind group layout, so every binding is declared identically in each module.
export const LAVA_COMMON_WGSL = /* wgsl */ `
struct LavaParams {
  width: u32,
  height: u32,
  dt: f32,
  gravity: f32,
  damping: f32,
  cooling: f32,
  quench: f32,
  steam: f32,
  openMask: u32,
  seaLevel: f32,
  pad1: u32,
  pad2: u32,
}

@group(0) @binding(0) var<uniform> params: LavaParams;
@group(0) @binding(1) var<storage, read> baseTerrain: array<f32>;
@group(0) @binding(2) var<storage, read_write> rock: array<f32>;
@group(0) @binding(3) var<storage, read_write> lava: array<f32>;
@group(0) @binding(4) var<storage, read_write> lavaFlux: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> lavaEmission: array<f32>;
@group(0) @binding(6) var<storage, read_write> water: array<f32>;
@group(0) @binding(7) var<storage, read_write> terrain: array<f32>;

const OPEN_NORTH: u32 = ${EDGE_BIT_NORTH}u;
const OPEN_EAST: u32 = ${EDGE_BIT_EAST}u;
const OPEN_SOUTH: u32 = ${EDGE_BIT_SOUTH}u;
const OPEN_WEST: u32 = ${EDGE_BIT_WEST}u;
const YIELD_STRENGTH: f32 = ${LAVA_YIELD_STRENGTH};
const FREEZE_DEPTH: f32 = ${LAVA_FREEZE_DEPTH};
const WET_DEPTH: f32 = ${LAVA_WET_DEPTH};
`;

/** Pass 1: per-cell lava outflow over base + rock (in place; only reads neighbour heads, which this pass never writes). */
export const LAVA_FLUX_SHADER_WGSL = /* wgsl */ `${LAVA_COMMON_WGSL}
fn headAt(i: u32) -> f32 {
  return baseTerrain[i] + rock[i] + lava[i];
}

// Bingham-style friction: the drive must beat a yield head that grows as the flow thins, so lava piles into lobes and stalls.
fn pipe(prev: f32, dh: f32, yieldHead: f32) -> f32 {
  return max(0.0, params.damping * prev + params.dt * params.gravity * (dh - yieldHead));
}

fn isOpen(bit: u32) -> bool {
  return (params.openMask & bit) != 0u;
}

@compute @workgroup_size(${LAVA_WORKGROUP_SIZE}, ${LAVA_WORKGROUP_SIZE})
fn fluxMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = params.width;
  let h = params.height;
  if (gid.x >= w || gid.y >= h) {
    return;
  }
  let x = gid.x;
  let y = gid.y;
  let i = y * w + x;
  let d = lava[i];
  if (d <= 0.0) {
    lavaFlux[i] = vec4<f32>(0.0);
    return;
  }
  let hc = baseTerrain[i] + rock[i] + d;
  let yieldHead = YIELD_STRENGTH / max(d, 1e-6);
  // Outside an open edge sits an empty cell at this cell's ground level, so the head drop is just the depth.
  let edgeDrop = d;
  let f = lavaFlux[i];
  var o = vec4<f32>(0.0);

  if (x > 0u) { o.x = pipe(f.x, hc - headAt(i - 1u), yieldHead); } else if (isOpen(OPEN_WEST)) { o.x = pipe(f.x, edgeDrop, yieldHead); }
  if (x + 1u < w) { o.y = pipe(f.y, hc - headAt(i + 1u), yieldHead); } else if (isOpen(OPEN_EAST)) { o.y = pipe(f.y, edgeDrop, yieldHead); }
  if (y > 0u) { o.z = pipe(f.z, hc - headAt(i - w), yieldHead); } else if (isOpen(OPEN_NORTH)) { o.z = pipe(f.z, edgeDrop, yieldHead); }
  if (y + 1u < h) { o.w = pipe(f.w, hc - headAt(i + w), yieldHead); } else if (isOpen(OPEN_SOUTH)) { o.w = pipe(f.w, edgeDrop, yieldHead); }

  // Scale so a cell never ships out more lava than it holds this step (keeps depth non-negative).
  let total = o.x + o.y + o.z + o.w;
  var k = 1.0;
  if (total * params.dt > d) {
    k = d / (total * params.dt);
  }
  lavaFlux[i] = o * k;
}
`;

/** Pass 2: lava depth update from net flux and crater emission (in place; flux is read-only here). */
export const LAVA_DEPTH_SHADER_WGSL = /* wgsl */ `${LAVA_COMMON_WGSL}
@compute @workgroup_size(${LAVA_WORKGROUP_SIZE}, ${LAVA_WORKGROUP_SIZE})
fn depthMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = params.width;
  let h = params.height;
  if (gid.x >= w || gid.y >= h) {
    return;
  }
  let x = gid.x;
  let y = gid.y;
  let i = y * w + x;
  let f = lavaFlux[i];

  var inflow = 0.0;
  if (x > 0u) { inflow += lavaFlux[i - 1u].y; }
  if (x + 1u < w) { inflow += lavaFlux[i + 1u].x; }
  if (y > 0u) { inflow += lavaFlux[i - w].w; }
  if (y + 1u < h) { inflow += lavaFlux[i + w].z; }
  // Flux through open edges is included in the outflow but has no receiver: that lava leaves the box.
  let outflow = f.x + f.y + f.z + f.w;
  lava[i] = max(lava[i] + params.dt * (inflow - outflow + lavaEmission[i]), 0.0);
}
`;
