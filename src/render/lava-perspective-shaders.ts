// WGSL for lava in the 3D view: the box-wall cut through a flow, billboard steam plumes off lava/water contacts, glow haze.

/** Steam sites every STEAM_LATTICE cells, each with STEAM_PUFFS staggered puffs plus one lava glow sprite (one instanced quad each). */
export const STEAM_LATTICE = 4;
export const STEAM_PUFFS = 4;
const SPRITES_PER_SITE = STEAM_PUFFS + 1;

export function steamPlumeInstanceCount(width: number, height: number): number {
  return Math.ceil(width / STEAM_LATTICE) * Math.ceil(height / STEAM_LATTICE) * SPRITES_PER_SITE;
}

export const LAVA_PERSPECTIVE_WGSL = /* wgsl */ `
const STEAM_LATTICE: f32 = ${STEAM_LATTICE}.0;
const STEAM_PUFFS: u32 = ${STEAM_PUFFS}u;
const SPRITES_PER_SITE: u32 = ${SPRITES_PER_SITE}u;

// Box-wall cut through the flow: a glowing molten band over a basalt band, both hanging from the surface.
fn lavaWallSection(base: vec3<f32>, gp: vec2<f32>, top: f32, y: f32, n: vec3<f32>, t: f32) -> vec3<f32> {
  let lava = lavaBilinear(gp);
  let rock = rockBilinear(gp);
  let below = top - y;
  let along = vec2<f32>(gp.x + gp.y, y * 2.5);
  var col = base;
  if (below > lava && below < lava + rock) {
    col = lightSurface(basaltSurface(along, 0.1).albedo, n);
  }
  if (lava > 0.02 && below <= lava) {
    // Cooler skins top and bottom, white-hot core.
    let k = clamp(below / max(lava, 1e-3), 0.0, 1.0);
    col = lavaHeatColor(0.3 + 0.6 * sin(k * 3.1415927) + 0.08 * gradNoise(along * 1.5 + vec2<f32>(t, 0.0)));
  }
  return col;
}

struct SteamVsOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) corner: vec2<f32>,
  @location(1) world: vec3<f32>,
  @location(2) @interpolate(flat) puff: vec4<f32>, // opacity, age 0..1 (-1 = glow sprite), seed, lava glow below
  @location(3) @interpolate(flat) sunLocal: vec3<f32>, // sun direction in the billboard's (right, up, toward-eye) frame
};

fn steamCorner(vid: u32) -> vec2<f32> {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0),
  );
  return corners[min(vid, 5u)];
}

// Instance = (lattice site, puff or glow sprite); sites away from lava collapse to a degenerate quad.
@vertex
fn vsSteam(@builtin(vertex_index) vid: u32, @builtin(instance_index) inst: u32) -> SteamVsOut {
  var result: SteamVsOut;
  result.clip = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  result.corner = vec2<f32>(0.0);
  result.world = vec3<f32>(0.0);
  result.puff = vec4<f32>(0.0);
  result.sunLocal = vec3<f32>(0.0, 1.0, 0.0);
  let cols = u32(ceil(frame.grid.x / STEAM_LATTICE));
  let site = inst / SPRITES_PER_SITE;
  let k = inst % SPRITES_PER_SITE;
  let lc = vec2<f32>(f32(site % cols), f32(site / cols));
  let base = (lc + 0.2 + 0.6 * hash22(lc + 5.3)) * STEAM_LATTICE;
  if (!lavaEnabled() || base.y > frame.grid.y - 1.0 || base.x > frame.grid.x - 1.0) {
    return result;
  }
  let c = steamCorner(vid % 6u);
  if (k == STEAM_PUFFS) {
    return lavaGlowSprite(base, c, hash21(lc + 3.1));
  }
  let fx = lavaFxBilinear(base);
  // Strong lava/water contacts throw up dense steam; deep lava pools (a crater lake) degas a thinner plume.
  // Only some sites degas, so a deep pool raises a plume rather than a wall of vapour.
  let degas = smoothstep(1.8, 3.2, lavaBilinear(base)) * 0.5 * step(0.4, hash21(lc + 7.7));
  let strength = max(smoothstep(0.3, 0.8, fx.y), degas);
  let seed = hash21(lc * 1.7 + vec2<f32>(f32(k) * 13.1, 2.9));
  let age = fract(frame.misc.y / (3.0 + 2.0 * seed) + seed + f32(k) / f32(STEAM_PUFFS));
  let fade = smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(0.4, 1.0, age));
  // Nearly invisible puffs are dropped before rasterisation: overdraw is the main cost of steam.
  if (strength * fade < 0.025) {
    return result;
  }
  // Puffs billow up, swell, and lean downwind as they rise.
  let sway = vec2<f32>(gradNoise(base * 0.3 + vec2<f32>(age * 2.0, seed * 9.0)), gradNoise(base * 0.3 - vec2<f32>(age * 2.0, -4.0)));
  let drift = STEAM_WIND * age * age * 22.0 + sway * age * 4.0;
  let ground = terrainBilinear(base) + waterBilinear(base);
  let centre = gridToWorld3(base + drift, ground * frame.heightStyle.w + 1.0 + age * (18.0 + 12.0 * seed));
  let size = (1.6 + 6.0 * sqrt(age)) * (0.7 + 0.5 * strength);
  let bb = billboardBasis();
  let world = centre + (bb.right * c.x + bb.up * c.y) * size;
  result.clip = frame.viewProj * vec4<f32>(world, 1.0);
  result.corner = c;
  result.world = world;
  result.puff = vec4<f32>(fade * strength * 0.85, age, seed, fx.x);
  let sun = sunDir();
  result.sunLocal = vec3<f32>(dot(sun, bb.right), dot(sun, bb.up), -dot(sun, bb.fwd));
  return result;
}

@fragment
fn fsSteam(input: SteamVsOut) -> @location(0) vec4<f32> {
  if (input.puff.y < 0.0) {
    return lavaGlowFragment(input.corner, input.puff.x);
  }
  let age = input.puff.y;
  let seed = input.puff.z;
  let q = rotate2(input.corner, seed * 6.2831853 + age * 1.3);
  // Cauliflower edge: three octaves eat into the disc so each puff has billows rather than a soft blur.
  let n = gradNoise(q * 1.6 + vec2<f32>(seed * 23.0, age * 1.2)) * 0.55 + gradNoise(q * 3.4 - vec2<f32>(seed * 7.0, age)) * 0.3
        + gradNoise(q * 7.1 + vec2<f32>(age * 2.0, seed * 3.0)) * 0.15;
  let a = (1.0 - smoothstep(0.45, 0.9, length(input.corner) + n * 0.45)) * input.puff.x;
  if (a < 0.003) {
    discard;
  }
  // Shade the puff as a noisy sphere: sunlit side bright, the far side grey, lit orange from below by young lava glow.
  let bulge = input.corner * 0.85 + vec2<f32>(n * 0.25);
  let normal = vec3<f32>(bulge, sqrt(max(1.0 - dot(bulge, bulge), 0.05)));
  let sunlit = max(dot(normalize(normal), input.sunLocal), 0.0);
  var col = mix(vec3<f32>(0.6, 0.63, 0.68), vec3<f32>(1.0, 0.995, 0.98), clamp(0.35 + 0.75 * sunlit + n * 0.15, 0.0, 1.0));
  col *= 1.0 - 0.35 * frame.effects.y;
  col += LAVA_GLOW_COLOR * input.puff.w * pow(1.0 - age, 1.5) * clamp(0.55 - 0.6 * input.corner.y, 0.0, 1.0);
  col = applyFog(col, input.world);
  return vec4<f32>(col * a, a);
}
`;
