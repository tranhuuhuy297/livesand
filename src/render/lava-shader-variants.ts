// Lava WGSL for a render module: the full molten/rock/steam shading, or constant stubs when no lava source is bound.
import { LAVA_SAMPLING_WGSL } from './lava-sampling-shaders';
import { LAVA_FX_READ_WGSL } from './lava-fx-field-shaders';
import { LAVA_SURFACE_WGSL } from './lava-surface-shaders';
import { LAVA_ROCK_STEAM_WGSL } from './lava-rock-steam-shaders';

// Same signatures as the real lava API, collapsed to constants, so lava-free pipelines compile as fast as before lava existed.
const LAVA_STUBS_WGSL = /* wgsl */ `
const LAVA_GLOW_COLOR = vec3<f32>(1.0, 0.36, 0.07);
struct Basalt {
  albedo: vec3<f32>,
  bump: vec2<f32>,
};
struct LavaShade {
  crust: vec3<f32>,
  emit: vec3<f32>,
};
fn lavaEnabled() -> bool { return false; }
fn lavaAt(c: vec2<i32>) -> f32 { return 0.0; }
fn lavaSmooth(p: vec2<f32>) -> vec3<f32> { return vec3<f32>(0.0); }
fn rockBilinear(p: vec2<f32>) -> f32 { return 0.0; }
fn lavaFxAt(c: vec2<i32>) -> vec4<f32> { return vec4<f32>(0.0); }
fn lavaFxBilinear(p: vec2<f32>) -> vec4<f32> { return vec4<f32>(0.0); }
fn lavaCoverage(depth: f32) -> f32 { return 0.0; }
fn basaltCoverage(rock: f32) -> f32 { return 0.0; }
fn basaltSurface(p: vec2<f32>, px: f32) -> Basalt { return Basalt(vec3<f32>(0.0), vec2<f32>(0.0)); }
fn applyLavaGlow(col: vec3<f32>, albedo: vec3<f32>, glow: f32, strength: f32) -> vec3<f32> { return col; }
fn shadeLava(p: vec2<f32>, depth: f32, slopeGrad: vec2<f32>, t: f32, px: f32) -> LavaShade {
  return LavaShade(vec3<f32>(0.0), vec3<f32>(0.0));
}
fn steamWisps(p: vec2<f32>, here: f32, glow: f32, t: f32) -> vec4<f32> { return vec4<f32>(0.0); }
fn lavaWallSection(base: vec3<f32>, gp: vec2<f32>, top: f32, y: f32, n: vec3<f32>, t: f32) -> vec3<f32> { return base; }
`;

/** Lava library for both renderers' modules; `enabled` false swaps in the stubs (the 3D-only lava entry points are added separately). */
export function lavaShadingWgsl(enabled: boolean): string {
  return enabled ? [LAVA_SAMPLING_WGSL, LAVA_FX_READ_WGSL, LAVA_SURFACE_WGSL, LAVA_ROCK_STEAM_WGSL].join('\n') : LAVA_STUBS_WGSL;
}
