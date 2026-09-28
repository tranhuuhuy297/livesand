// WGSL for the 3D view environment: sun, sky/backdrop gradient, distance fog, floor shadow and surface lighting.

export const PERSPECTIVE_SKY_LIGHTING_WGSL = /* wgsl */ `
const HORIZON_COLOR = vec3<f32>(0.80, 0.87, 0.94);
const ZENITH_COLOR = vec3<f32>(0.19, 0.41, 0.78);
const BACKDROP_LOW = vec3<f32>(0.42, 0.50, 0.60);

fn sunDir() -> vec3<f32> {
  return normalize(vec3<f32>(-0.5, 0.52, 0.42));
}

fn skyColor(dir: vec3<f32>) -> vec3<f32> {
  let up = clamp(dir.y, -1.0, 1.0);
  var col = mix(HORIZON_COLOR, ZENITH_COLOR, pow(max(up, 0.0), 0.55));
  let s = max(dot(dir, sunDir()), 0.0);
  col += vec3<f32>(1.0, 0.86, 0.62) * (pow(s, 700.0) * 2.5 + pow(s, 10.0) * 0.16);
  return col;
}

// Below the horizon the view fades into a soft studio backdrop instead of a hard floor.
fn backdropColor(dir: vec3<f32>) -> vec3<f32> {
  if (dir.y >= 0.0) {
    return skyColor(dir);
  }
  return mix(HORIZON_COLOR, BACKDROP_LOW, pow(clamp(-dir.y * 1.3, 0.0, 1.0), 0.75));
}

fn fogColor(dir: vec3<f32>) -> vec3<f32> {
  return backdropColor(dir);
}

fn applyFog(col: vec3<f32>, world: vec3<f32>) -> vec3<f32> {
  let v = world - frame.eye.xyz;
  let dist = length(v);
  let f = 1.0 - exp(-max(dist - frame.viewport.z, 0.0) * frame.viewport.w);
  return mix(col, fogColor(v / max(dist, 1e-4)), clamp(f, 0.0, 1.0));
}

// Lambert sun (optionally shadowed) + sky/ground hemisphere ambient; hillshade off flattens the direct term.
fn lightSurfaceShadowed(albedo: vec3<f32>, n: vec3<f32>, sunVisible: f32) -> vec3<f32> {
  let diffuse = max(dot(n, sunDir()), 0.0) * sunVisible;
  let hemi = mix(vec3<f32>(0.42, 0.38, 0.33), vec3<f32>(0.62, 0.72, 0.90), n.y * 0.5 + 0.5);
  let direct = mix(0.62, diffuse, frame.misc.x);
  return albedo * (hemi * 0.66 + vec3<f32>(1.0, 0.95, 0.86) * direct * 0.8);
}

fn lightSurface(albedo: vec3<f32>, n: vec3<f32>) -> vec3<f32> {
  return lightSurfaceShadowed(albedo, n, 1.0);
}

// Soft sun shadow by marching the heightfield toward the sun (penumbra from the closest miss).
fn terrainSunVisibility(gp: vec2<f32>, h: f32) -> f32 {
  let sun = sunDir();
  let vs = max(frame.heightStyle.w, 1e-3);
  let horiz = max(length(sun.xz), 1e-3);
  let stepDir = sun.xz / horiz;
  let rise = sun.y / horiz / vs; // height gained per grid cell along the ray, in terrain units
  var visible = 1.0;
  var dist = 1.0 + hash21(gp * 1.37) * 0.8; // jittered start hides step banding in the penumbra
  for (var i = 0; i < 28; i++) {
    let q = gp + stepDir * dist;
    if (any(q < vec2<f32>(0.0)) || any(q > frame.grid.xy - 1.0)) {
      break;
    }
    let above = h + rise * dist - terrainBilinear(q);
    visible = min(visible, clamp(above * 1.4 / dist * 8.0 + 0.5, 0.0, 1.0));
    dist *= 1.14;
  }
  return visible;
}

fn faceTowardEye(n: vec3<f32>, world: vec3<f32>) -> vec3<f32> {
  return select(-n, n, dot(n, frame.eye.xyz - world) > 0.0);
}

// Cross-section of the sand at the box walls: warped horizontal strata, darker toward the floor.
fn strataColor(y: f32, gp: vec2<f32>) -> vec3<f32> {
  let along = gp.x + gp.y;
  let warp = gradNoise(vec2<f32>(along * 0.045, y * 0.12)) * 2.2;
  let band = sin((y + warp) * 0.85) * 0.5 + 0.5;
  let grain = gradNoise(vec2<f32>(along * 0.9, y * 3.0)) * 0.06;
  let col = mix(vec3<f32>(0.64, 0.51, 0.36), vec3<f32>(0.84, 0.72, 0.54), band) * (0.95 + grain);
  return col * mix(0.7, 1.0, smoothstep(frame.misc.w, frame.misc.w + 12.0, y));
}

// Soft shadow of the box on an invisible floor plane (pushed away from the sun) plus contact darkening.
fn floorShadow(hit: vec3<f32>) -> f32 {
  let sun = sunDir();
  let boxTop = frame.heightStyle.y * frame.heightStyle.w - frame.misc.w;
  let offset = -sun.xz / max(sun.y, 0.2) * boxTop * 0.45;
  let halfBox = frame.grid.xy * 0.5;
  let castShadow = 1.0 - smoothstep(-10.0, 45.0, sdBox2(hit.xz - offset, halfBox));
  let contact = 1.0 - smoothstep(0.0, 12.0, sdBox2(hit.xz, halfBox));
  return clamp(castShadow * 0.4 + contact * 0.3, 0.0, 0.65);
}

struct SkyVsOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) ndc: vec2<f32>,
};

@vertex
fn vsSky(@builtin(vertex_index) vid: u32) -> SkyVsOut {
  let xy = vec2<f32>(f32((vid << 1u) & 2u), f32(vid & 2u)) * 2.0 - 1.0;
  var result: SkyVsOut;
  result.clip = vec4<f32>(xy, 0.999, 1.0);
  result.ndc = xy;
  return result;
}

@fragment
fn fsSky(input: SkyVsOut) -> @location(0) vec4<f32> {
  let farH = frame.invViewProj * vec4<f32>(input.ndc, 1.0, 1.0);
  let dir = normalize(farH.xyz / farH.w - frame.eye.xyz);
  var col = backdropColor(dir);
  let tHit = (frame.misc.w - frame.eye.y) / min(dir.y, -1e-4);
  if (dir.y < 0.0 && tHit > 0.0) {
    let hit = frame.eye.xyz + dir * tHit;
    let fade = exp(-max(tHit - frame.viewport.z, 0.0) * frame.viewport.w * 2.0);
    col *= 1.0 - floorShadow(hit) * fade;
  }
  return vec4<f32>(col, 1.0);
}
`;
