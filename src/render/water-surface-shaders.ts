// WGSL: procedural noise, flow-advected ripples, depth-based water colour, foam, caustics and rain rings.

export const WATER_SURFACE_WGSL = /* wgsl */ `
fn hash21(p: vec2<f32>) -> f32 {
  var q = fract(p * vec2<f32>(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}
fn hash22(p: vec2<f32>) -> vec2<f32> {
  let n = hash21(p);
  return vec2<f32>(n, hash21(p + n + 17.0));
}
// Gradient noise in [-1, 1].
fn gradNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let ga = hash22(i) * 2.0 - 1.0;
  let gb = hash22(i + vec2<f32>(1.0, 0.0)) * 2.0 - 1.0;
  let gc = hash22(i + vec2<f32>(0.0, 1.0)) * 2.0 - 1.0;
  let gd = hash22(i + vec2<f32>(1.0, 1.0)) * 2.0 - 1.0;
  let a = dot(ga, f);
  let b = dot(gb, f - vec2<f32>(1.0, 0.0));
  let c = dot(gc, f - vec2<f32>(0.0, 1.0));
  let d = dot(gd, f - vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4;
}

// Two drifting octaves read as wind ripples on still water.
fn waveField(p: vec2<f32>, t: f32) -> f32 {
  return gradNoise(p * 0.21 + vec2<f32>(t * 0.12, -t * 0.08)) * 0.65
       + gradNoise(p * 0.5 + vec2<f32>(-t * 0.19, t * 0.15)) * 0.35;
}

// Flow-map technique: two phase-shifted copies advected along the flow, cross-faded so resets stay invisible.
fn flowWaves(p: vec2<f32>, flow: vec2<f32>, t: f32) -> f32 {
  let phaseA = fract(t * 0.45);
  let phaseB = fract(t * 0.45 + 0.5);
  let weightA = 1.0 - abs(1.0 - 2.0 * phaseA);
  let adv = clamp(flow, vec2<f32>(-6.0), vec2<f32>(6.0)) * 1.6;
  let a = waveField(p - adv * phaseA, t);
  let b = waveField(p - adv * phaseB + vec2<f32>(7.3, 3.1), t);
  return mix(b, a, weightA);
}

fn flowWaveGradient(p: vec2<f32>, flow: vec2<f32>, t: f32) -> vec2<f32> {
  let e = 0.3;
  let c = flowWaves(p, flow, t);
  let gx = flowWaves(p + vec2<f32>(e, 0.0), flow, t) - c;
  let gy = flowWaves(p + vec2<f32>(0.0, e), flow, t) - c;
  return vec2<f32>(gx, gy) / e;
}

// Shallow turquoise -> ocean blue -> deep navy with depth.
fn waterColor(depth: f32) -> vec3<f32> {
  let shallow = vec3<f32>(0.20, 0.78, 0.80);
  let mid = vec3<f32>(0.05, 0.50, 0.80);
  let deep = vec3<f32>(0.02, 0.16, 0.45);
  let k = 1.0 - exp(-depth * 0.3);
  return select(mix(mid, deep, k * 2.0 - 1.0), mix(shallow, mid, k * 2.0), k < 0.5);
}

// White water where the flow is fast plus a lacy band along the shoreline.
fn foamAmount(p: vec2<f32>, flow: vec2<f32>, depth: f32, t: f32) -> f32 {
  let speed = length(flow);
  let turbulence = smoothstep(1.2, 4.5, speed);
  let shore = 1.0 - smoothstep(0.03, 0.22, depth);
  let n = flowWaves(p * 2.0, flow * 0.5, t * 1.6) * 0.5 + 0.5;
  let streaks = smoothstep(0.55, 0.85, n);
  return clamp(turbulence * (0.15 + 0.9 * streaks) + shore * streaks * 0.35, 0.0, 1.0);
}

// Ridged noise interference reads as sunlight caustics on the bed of shallow water.
fn caustics(p: vec2<f32>, t: f32) -> f32 {
  let a = gradNoise(p * 0.5 + vec2<f32>(t * 0.35, t * 0.21));
  let b = gradNoise(p * 0.65 - vec2<f32>(t * 0.27, -t * 0.18) + 5.7);
  let ridge = 1.0 - abs(a - b);
  return pow(clamp(ridge, 0.0, 1.0), 7.0);
}

// Expanding droplet rings; intensity 0..1 decides how many cells drip per cycle.
fn rainRings(p: vec2<f32>, intensity: f32, t: f32, px: f32) -> f32 {
  let cell = 5.0;
  let q = p / cell;
  let id = floor(q);
  let rnd = hash22(id);
  let cycle = t * (0.9 + 0.9 * rnd.x) + rnd.y;
  let phase = fract(cycle);
  let dropOn = step(hash21(id + floor(cycle) * vec2<f32>(3.1, 7.7)), intensity);
  let center = id + 0.25 + 0.5 * hash22(id + 11.0);
  let d = length(q - center);
  let w = max(px / cell, 0.02) * 1.3;
  let ring = 1.0 - smoothstep(0.0, w, abs(d - phase * 0.42));
  return ring * (1.0 - phase) * dropOn;
}
`;
