// WGSL: solid basalt rock, lava glow on nearby ground, and steam where lava meets water.

export const LAVA_ROCK_STEAM_WGSL = /* wgsl */ `
// Basalt only reads as rock once it is thicker than a crust film (about 0.3 units).
fn basaltCoverage(rock: f32) -> f32 {
  return smoothstep(0.1, 0.35, rock);
}

struct Basalt {
  albedo: vec3<f32>,
  bump: vec2<f32>, // surface height gradient (grid units) added to the terrain slope for lighting
};

// Solid basalt: dark rubble of uneven blocks with bevelled edges, lumpy flow relief, oxidised patches and vesicles.
fn basaltSurface(p: vec2<f32>, px: f32) -> Basalt {
  let blockScale = 0.5;
  let warp = vec2<f32>(gradNoise(p * 0.21 + 4.0), gradNoise(p * 0.21 - 9.0)) * 1.4;
  let blocks = crustCells((p + warp) * blockScale + vec2<f32>(17.0, 3.0));
  let broad = gradNoise(p * 0.12 + 11.0) * 0.5 + 0.5;
  let rust = smoothstep(0.2, 0.7, gradNoise(p * 0.08 - 5.0));
  let fine = gradNoise(p * 2.2 + 7.1);
  let pits = smoothstep(0.5, 0.85, gradNoise(p * 4.1 - 3.3));
  var col = mix(vec3<f32>(0.13, 0.13, 0.14), vec3<f32>(0.33, 0.315, 0.31), broad * 0.6 + blocks.y * 0.4);
  col = mix(col, col * vec3<f32>(1.35, 0.95, 0.8), rust * 0.6);
  col *= (0.9 + 0.2 * fine) * (1.0 - 0.3 * pits);
  var result: Basalt;
  result.albedo = col * mix(0.62, 1.0, smoothstep(0.0, 0.06 + px * blockScale, blocks.x));
  // Blocks are low domes (edges slope away from the centre) on top of broad pressure-ridge lumps.
  let toCentre = blocks.zw / max(length(blocks.zw), 1e-4);
  let edge = 1.0 - smoothstep(0.02, 0.25, blocks.x);
  let e = 0.5;
  let lump = gradNoise(p * 0.3) + 0.4 * gradNoise(p * 1.1 + 2.0);
  let lumpX = gradNoise((p + vec2<f32>(e, 0.0)) * 0.3) + 0.4 * gradNoise((p + vec2<f32>(e, 0.0)) * 1.1 + 2.0);
  let lumpY = gradNoise((p + vec2<f32>(0.0, e)) * 0.3) + 0.4 * gradNoise((p + vec2<f32>(0.0, e)) * 1.1 + 2.0);
  result.bump = toCentre * edge * 0.35 + vec2<f32>(lumpX - lump, lumpY - lump) / e * 0.35;
  return result;
}

// Lava light on nearby ground: warm bounce light on the albedo plus a halo so even black rock glows.
fn applyLavaGlow(col: vec3<f32>, albedo: vec3<f32>, glow: f32, strength: f32) -> vec3<f32> {
  return col + (albedo * 2.0 + vec3<f32>(glow * 0.45)) * LAVA_GLOW_COLOR * glow * strength;
}

// Billowing steam over the lava/water contact: layered noise puffs drifting downwind, thicker where the source is strong.
fn steamDensity(p: vec2<f32>, source: f32, t: f32) -> f32 {
  let q = p * 0.2 - STEAM_WIND * t * 0.45;
  let n = gradNoise(q) * 0.55 + gradNoise(q * 2.3 + vec2<f32>(t * 0.25, 3.1)) * 0.3 + gradNoise(q * 5.1 - t * 0.35) * 0.15;
  return clamp(smoothstep(-0.4, 0.5, n + source * 0.6 - 0.2) * sqrt(source) * 1.25, 0.0, 0.95);
}

// Steam blown downwind: the field sampled upwind makes the vapour trail away from the contact line.
fn steamTrail(p: vec2<f32>, here: f32) -> f32 {
  let dir = normalize(STEAM_WIND);
  var s = here;
  for (var k = 1; k <= 4; k++) {
    s = max(s, lavaFxBilinear(p - dir * f32(k) * 3.5).y * (1.0 - f32(k) * 0.19));
  }
  return s;
}

// Steam over the ground/water: rgb = lit vapour colour, a = coverage (lit from the north-west, underlit by lava).
fn steamWisps(p: vec2<f32>, here: f32, glow: f32, t: f32) -> vec4<f32> {
  if (!lavaEnabled()) {
    return vec4<f32>(0.0);
  }
  let source = steamTrail(p, here);
  if (source < 0.004) {
    return vec4<f32>(0.0);
  }
  let d = steamDensity(p, source, t);
  let towardLight = steamDensity(p + vec2<f32>(-0.9, -1.2), source, t);
  let lit = clamp(0.8 + (d - towardLight) * 1.6, 0.55, 1.05);
  let col = mix(vec3<f32>(0.9, 0.92, 0.95), vec3<f32>(1.0, 0.7, 0.5), clamp(glow * 0.8, 0.0, 0.6)) * lit;
  return vec4<f32>(col, d);
}
`;
