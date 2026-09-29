// WGSL: per-frame uniforms, read-only views of the sim storage buffers, and smooth samplers over them.

/** Frame uniform block (layout mirrored by render-frame-uniforms.ts) + sim storage bindings, group 0. */
export const FRAME_BINDINGS_WGSL = /* wgsl */ `
struct Frame {
  viewProj: mat4x4<f32>,
  invViewProj: mat4x4<f32>,
  eye: vec4<f32>,          // xyz camera position (3D only)
  grid: vec4<f32>,         // width, height, 1/width, 1/height
  heightStyle: vec4<f32>,  // minHeight, maxHeight, contourInterval, verticalScale
  misc: vec4<f32>,         // hillshade on/off, timeSec, villageCount, base plane y (world)
  viewport: vec4<f32>,     // width px, height px, fog start, fog density
  effects: vec4<f32>,      // sea level (display only), storm 0..1, source count, 2D map turned a quarter (0/1)
  villages: array<vec4<f32>, 16>,    // x, y, radius (grid units), state code (0 safe, 1 flooding, 2 lost)
  villageInfo: array<vec4<f32>, 16>, // flood01, unused...
  sources: array<vec4<f32>, 8>,      // springs: x, y, radius (grid units), unused
  atmosphere: vec4<f32>,             // volcanic ash 0..1, unused...
};
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> terrainBuf: array<f32>;
@group(0) @binding(2) var<storage, read> waterBuf: array<f32>;
@group(0) @binding(3) var<storage, read> fluxBuf: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> emissionBuf: array<f32>;
`;

// Emits a cubic B-spline sampler returning (value, d/dx, d/dy); smoother than bilinear so contours stay round when magnified.
export function bsplineSampler(name: string, fetch: string): string {
  return /* wgsl */ `
fn ${name}(p: vec2<f32>) -> vec3<f32> {
  let base = floor(p);
  let f = p - base;
  let wx = bsplineWeights(f.x);
  let wy = bsplineWeights(f.y);
  let sx = bsplineSlopes(f.x);
  let sy = bsplineSlopes(f.y);
  let origin = vec2<i32>(base) - vec2<i32>(1, 1);
  var acc = vec3<f32>(0.0);
  for (var j = 0; j < 4; j++) {
    var row = 0.0;
    var rowSlope = 0.0;
    for (var i = 0; i < 4; i++) {
      let v = ${fetch}(origin + vec2<i32>(i, j));
      row += wx[i] * v;
      rowSlope += sx[i] * v;
    }
    acc += vec3<f32>(wy[j] * row, wy[j] * rowSlope, sy[j] * row);
  }
  return acc;
}
`;
}

// Emits a bilinear sampler over clamped cell fetches.
export function bilinearSampler(name: string, fetch: string, type: string): string {
  return /* wgsl */ `
fn ${name}(p: vec2<f32>) -> ${type} {
  let base = floor(p);
  let f = p - base;
  let c = vec2<i32>(base);
  let top = mix(${fetch}(c), ${fetch}(c + vec2<i32>(1, 0)), f.x);
  let bottom = mix(${fetch}(c + vec2<i32>(0, 1)), ${fetch}(c + vec2<i32>(1, 1)), f.x);
  return mix(top, bottom, f.y);
}
`;
}

/** Clamped cell fetches, B-spline terrain/water (value + gradient) and bilinear terrain/flux/emission. */
export const SIM_SAMPLING_WGSL = /* wgsl */ `
fn cellIndex(c: vec2<i32>) -> u32 {
  let size = vec2<i32>(frame.grid.xy);
  let q = clamp(c, vec2<i32>(0, 0), size - vec2<i32>(1, 1));
  return u32(q.y * size.x + q.x);
}
fn terrainAt(c: vec2<i32>) -> f32 { return terrainBuf[cellIndex(c)]; }
fn waterAt(c: vec2<i32>) -> f32 { return max(waterBuf[cellIndex(c)], 0.0); }
fn fluxAt(c: vec2<i32>) -> vec4<f32> { return max(fluxBuf[cellIndex(c)], vec4<f32>(0.0)); }
fn emissionAt(c: vec2<i32>) -> f32 { return max(emissionBuf[cellIndex(c)], 0.0); }

fn bsplineWeights(t: f32) -> vec4<f32> {
  let t2 = t * t;
  let t3 = t2 * t;
  let s = 1.0 - t;
  return vec4<f32>(s * s * s, 3.0 * t3 - 6.0 * t2 + 4.0, -3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0, t3) / 6.0;
}
fn bsplineSlopes(t: f32) -> vec4<f32> {
  let s = 1.0 - t;
  let t2 = t * t;
  return vec4<f32>(-0.5 * s * s, 1.5 * t2 - 2.0 * t, -1.5 * t2 + t + 0.5, 0.5 * t2);
}
${bsplineSampler('terrainSmooth', 'terrainAt')}
${bsplineSampler('waterSmooth', 'waterAt')}
${bilinearSampler('terrainBilinear', 'terrainAt', 'f32')}
${bilinearSampler('fluxBilinear', 'fluxAt', 'vec4<f32>')}
${bilinearSampler('emissionBilinear', 'emissionAt', 'f32')}

// Net outflow per unit depth approximates the flow velocity (cells/s): x = east, y = south.
fn flowVelocity(p: vec2<f32>, depth: f32) -> vec2<f32> {
  let f = fluxBilinear(p);
  return vec2<f32>(f.y - f.x, f.w - f.z) / max(depth, 0.25);
}
fn heightToUnit(h: f32) -> f32 {
  return clamp((h - frame.heightStyle.x) / max(frame.heightStyle.y - frame.heightStyle.x, 1e-3), 0.0, 1.0);
}
`;
