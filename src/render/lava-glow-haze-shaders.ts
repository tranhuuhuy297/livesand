// WGSL for the 3D view: camera-facing billboard basis and a soft additive haze over hot lava (stands in for bloom).

export const LAVA_GLOW_HAZE_WGSL = /* wgsl */ `
struct Billboard {
  right: vec3<f32>,
  up: vec3<f32>,
  fwd: vec3<f32>,
};

// Camera-facing basis: forward through the screen centre, right along the horizon.
fn billboardBasis() -> Billboard {
  let farH = frame.invViewProj * vec4<f32>(0.0, 0.0, 1.0, 1.0);
  var b: Billboard;
  b.fwd = normalize(farH.xyz / farH.w - frame.eye.xyz);
  let side = cross(b.fwd, vec3<f32>(0.0, 1.0, 0.0));
  b.right = select(vec3<f32>(1.0, 0.0, 0.0), normalize(side), length(side) > 1e-4); // straight-down views have no horizon
  b.up = cross(b.right, b.fwd);
  return b;
}

// One haze sprite per steam site over lava; puff.y = -1 tells fsSteam to draw it as additive glow.
fn lavaGlowSprite(base: vec2<f32>, corner: vec2<f32>, seed: f32) -> SteamVsOut {
  var result: SteamVsOut;
  result.clip = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  result.corner = corner;
  result.world = vec3<f32>(0.0);
  result.puff = vec4<f32>(0.0, -1.0, seed, 0.0);
  result.sunLocal = vec3<f32>(0.0, 1.0, 0.0);
  let hot = lavaPresence(lavaBilinear(base));
  if (hot < 0.05) {
    return result;
  }
  let size = 6.5;
  let surface = gridToWorld3(base, terrainBilinear(base) * frame.heightStyle.w + 0.8);
  // Pulled toward the eye so the terrain under the lava does not slice the sprite with a hard edge.
  let centre = surface + normalize(frame.eye.xyz - surface) * size * 0.9;
  let b = billboardBasis();
  let world = centre + (b.right * corner.x + b.up * corner.y) * size;
  result.clip = frame.viewProj * vec4<f32>(world, 1.0);
  result.world = world;
  let breathe = 0.85 + 0.15 * sin(frame.misc.y * 1.7 + seed * 6.2831853);
  result.puff.x = hot * 0.07 * breathe;
  return result;
}

// Premultiplied colour with zero alpha: the blend adds it on top without dimming what is behind.
fn lavaGlowFragment(corner: vec2<f32>, strength: f32) -> vec4<f32> {
  let g = exp(-dot(corner, corner) * 3.2) * strength;
  return vec4<f32>(LAVA_GLOW_COLOR * g, 0.0);
}
`;
