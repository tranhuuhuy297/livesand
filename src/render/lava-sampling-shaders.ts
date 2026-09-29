// WGSL: lava/rock/emission storage bindings (group 0, bindings 5, 6, 8), their samplers and the lava neighbourhood probe.
import { bilinearSampler, bsplineSampler } from './sim-sampling-shaders';

export const LAVA_SAMPLING_WGSL = /* wgsl */ `
@group(0) @binding(5) var<storage, read> lavaBuf: array<f32>;  // molten lava depth per cell (already in terrainBuf)
@group(0) @binding(6) var<storage, read> rockBuf: array<f32>;  // solidified basalt thickness per cell (already in terrainBuf)
@group(0) @binding(8) var<storage, read> lavaEmitBuf: array<f32>; // lava poured per cell right now (fragment stage only)

// The no-lava fallback binds a buffer smaller than the grid, so this is uniform per draw and cheap to branch on.
fn lavaEnabled() -> bool {
  return arrayLength(&lavaBuf) >= u32(frame.grid.x) * u32(frame.grid.y);
}
fn lavaAt(c: vec2<i32>) -> f32 {
  let n = arrayLength(&lavaBuf);
  let i = cellIndex(c);
  return select(0.0, max(lavaBuf[min(i, n - 1u)], 0.0), i < n);
}
fn rockAt(c: vec2<i32>) -> f32 {
  let n = arrayLength(&rockBuf);
  let i = cellIndex(c);
  return select(0.0, max(rockBuf[min(i, n - 1u)], 0.0), i < n);
}
fn lavaEmitAt(c: vec2<i32>) -> f32 {
  let n = arrayLength(&lavaEmitBuf);
  let i = cellIndex(c);
  return select(0.0, max(lavaEmitBuf[min(i, n - 1u)], 0.0), i < n);
}
${bsplineSampler('lavaSmooth', 'lavaAt')}
${bilinearSampler('lavaEmitBilinear', 'lavaEmitAt', 'f32')}
${bilinearSampler('lavaBilinear', 'lavaAt', 'f32')}
${bilinearSampler('rockBilinear', 'rockAt', 'f32')}
${bilinearSampler('waterBilinear', 'waterAt', 'f32')}

// 0..1 visible lava; deeper lava counts a little more so pools out-glow thin sheets.
fn lavaPresence(depth: f32) -> f32 {
  return smoothstep(0.03, 0.45, depth) * (0.65 + 0.35 * smoothstep(0.3, 1.6, depth));
}

// 0..1 how freshly lava is being poured around p (brush or crater): fresh lava has had no time to crust over.
fn lavaFreshness(p: vec2<f32>) -> f32 {
  let e = max(lavaEmitBilinear(p), max(lavaEmitBilinear(p + vec2<f32>(3.0, 0.0)), lavaEmitBilinear(p - vec2<f32>(3.0, 0.0))));
  let e2 = max(lavaEmitBilinear(p + vec2<f32>(0.0, 3.0)), lavaEmitBilinear(p - vec2<f32>(0.0, 3.0)));
  return smoothstep(0.02, 0.5, max(e, e2));
}

// Visible water (simulated or display sea) at p, 0..1.
fn lavaWetness(p: vec2<f32>) -> f32 {
  return smoothstep(0.04, 0.35, displayDepth(waterBilinear(p), terrainBilinear(p)));
}

// (glow, steam): lava light spilling onto the ground around it, and where lava and water are close enough to boil.
// Steam tolerates a few cells of fresh rock between the two, as a quenched lava front usually has.
fn lavaNeighbourhood(p: vec2<f32>) -> vec2<f32> {
  let here = lavaPresence(lavaBilinear(p));
  var glow = here * 0.3;
  var lavaNear = here;
  for (var i = 0; i < 8; i++) {
    let far = (i & 1) == 1;
    let a = f32(i) * 0.7853982 + 0.39;
    let l = lavaPresence(lavaBilinear(p + vec2<f32>(cos(a), sin(a)) * select(2.6, 6.0, far)));
    glow += l * select(0.13, 0.075, far);
    lavaNear = max(lavaNear, l * select(1.0, 0.6, far));
  }
  var steam = 0.0;
  if (lavaNear > 0.02) {
    var waterNear = lavaWetness(p);
    for (var i = 0; i < 8; i++) {
      let far = (i & 1) == 1;
      let a = f32(i) * 0.7853982 + 0.2;
      waterNear = max(waterNear, lavaWetness(p + vec2<f32>(cos(a), sin(a)) * select(2.6, 5.5, far)) * select(0.9, 0.5, far));
    }
    steam = lavaNear * waterNear;
  }
  // Deep pools (a crater lake) also degas: a thin fume that the renderers trail downwind.
  steam = max(steam, smoothstep(1.8, 3.2, lavaBilinear(p)) * 0.3);
  return vec2<f32>(min(glow, 1.0), steam);
}
`;
