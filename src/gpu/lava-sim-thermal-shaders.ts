// WGSL for lava cooling into rock, water quench/steam coupling, and writing the effective terrain for the water sim.
import { LAVA_COMMON_WGSL, LAVA_WORKGROUP_SIZE } from './lava-sim-shaders';

// Guards shared by every per-cell entry point below.
const CELL_PRELUDE_WGSL = /* wgsl */ `
  let w = params.width;
  let h = params.height;
  if (gid.x >= w || gid.y >= h) {
    return;
  }
  let x = gid.x;
  let y = gid.y;
  let i = y * w + x;
`;

/** Pass 3: lava solidifies into rock (faster where it touches water); only own lava/rock are written, water is read. */
export const LAVA_COOL_SHADER_WGSL = /* wgsl */ `${LAVA_COMMON_WGSL}
// Simulated water, or the painted sea of real coasts and Mount Ember: the ground (last compose, read-only in this pass,
// so neighbours never race on rock/lava being written) still below sea level.
fn wetAt(i: u32) -> bool {
  return water[i] > WET_DEPTH || terrain[i] < params.seaLevel;
}

@compute @workgroup_size(${LAVA_WORKGROUP_SIZE}, ${LAVA_WORKGROUP_SIZE})
fn coolMain(@builtin(global_invocation_id) gid: vec3<u32>) {
${CELL_PRELUDE_WGSL}
  let d = lava[i];
  if (d <= 0.0) {
    return;
  }
  var wet = wetAt(i);
  if (x > 0u) { wet = wet || wetAt(i - 1u); }
  if (x + 1u < w) { wet = wet || wetAt(i + 1u); }
  if (y > 0u) { wet = wet || wetAt(i - w); }
  if (y + 1u < h) { wet = wet || wetAt(i + w); }

  var rate = params.cooling;
  if (wet) {
    rate += params.quench;
  }
  var solid = d * min(1.0, rate * params.dt);
  var rest = d - solid;
  // Thin films freeze outright (only while cooling is on), so flows end in finite time instead of glowing forever.
  if (rate > 0.0 && rest < FREEZE_DEPTH) {
    solid = d;
    rest = 0.0;
  }
  lava[i] = rest;
  rock[i] = rock[i] + solid;
}
`;

/** Pass 4: water touching lava boils off (only own water is written; lava is read-only here). */
export const LAVA_STEAM_SHADER_WGSL = /* wgsl */ `${LAVA_COMMON_WGSL}
@compute @workgroup_size(${LAVA_WORKGROUP_SIZE}, ${LAVA_WORKGROUP_SIZE})
fn steamMain(@builtin(global_invocation_id) gid: vec3<u32>) {
${CELL_PRELUDE_WGSL}
  let depth = water[i];
  if (depth <= 0.0) {
    return;
  }
  var hot = lava[i];
  if (x > 0u) { hot = max(hot, lava[i - 1u]); }
  if (x + 1u < w) { hot = max(hot, lava[i + 1u]); }
  if (y > 0u) { hot = max(hot, lava[i - w]); }
  if (y + 1u < h) { hot = max(hot, lava[i + w]); }
  if (hot <= 0.0) {
    return;
  }
  water[i] = max(depth - params.steam * params.dt * hot, 0.0);
}
`;

/** Final pass: the water sim and renderers see ground = base + rock + lava, so water flows around (and over) lava. */
export const LAVA_COMPOSE_SHADER_WGSL = /* wgsl */ `${LAVA_COMMON_WGSL}
@compute @workgroup_size(${LAVA_WORKGROUP_SIZE}, ${LAVA_WORKGROUP_SIZE})
fn composeMain(@builtin(global_invocation_id) gid: vec3<u32>) {
${CELL_PRELUDE_WGSL}
  terrain[i] = baseTerrain[i] + rock[i] + lava[i];
}
`;
