// WGSL: molten lava (blackbody ramp, drifting crust plates with glowing cracks), basalt rock, lava glow and steam.

export const LAVA_SURFACE_WGSL = /* wgsl */ `
const LAVA_GLOW_COLOR = vec3<f32>(1.0, 0.36, 0.07);
const STEAM_WIND = vec2<f32>(0.55, -0.35);

// Blackbody-like ramp for molten rock: black-red crust -> deep red -> orange -> yellow -> white-hot.
fn lavaHeatColor(t: f32) -> vec3<f32> {
  var stops = array<vec4<f32>, 6>(
    vec4<f32>(0.00, 0.16, 0.015, 0.005),
    vec4<f32>(0.22, 0.52, 0.035, 0.008),
    vec4<f32>(0.45, 0.92, 0.20, 0.015),
    vec4<f32>(0.66, 1.00, 0.47, 0.05),
    vec4<f32>(0.84, 1.00, 0.76, 0.26),
    vec4<f32>(1.00, 1.00, 0.97, 0.80),
  );
  let x = clamp(t, 0.0, 1.0);
  var col = stops[0].yzw;
  for (var i = 1; i < 6; i++) {
    let a = stops[i - 1];
    let b = stops[i];
    col = select(col, mix(a.yzw, b.yzw, clamp((x - a.x) / (b.x - a.x), 0.0, 1.0)), x >= a.x);
  }
  return col;
}

fn crustJitter(c: vec2<f32>) -> vec2<f32> {
  return 0.1 + 0.8 * hash22(c);
}

// Voronoi plates: (distance to the nearest border, plate id hash, vector to the plate centre); exact borders keep cracks even.
fn crustCells(x: vec2<f32>) -> vec4<f32> {
  let n = floor(x);
  let f = x - n;
  var mg = vec2<f32>(0.0);
  var mr = vec2<f32>(0.0);
  var md = 8.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let g = vec2<f32>(f32(i), f32(j));
      let r = g + crustJitter(n + g) - f;
      let d = dot(r, r);
      if (d < md) {
        md = d;
        mr = r;
        mg = g;
      }
    }
  }
  var border = 8.0;
  for (var j = -2; j <= 2; j++) {
    for (var i = -2; i <= 2; i++) {
      let g = mg + vec2<f32>(f32(i), f32(j));
      let r = g + crustJitter(n + g) - f;
      let e = r - mr;
      if (dot(e, e) > 1e-5) {
        border = min(border, dot(0.5 * (mr + r), normalize(e)));
      }
    }
  }
  return vec4<f32>(border, hash21(n + mg + vec2<f32>(31.0, 17.0)), mr);
}

struct LavaShade {
  crust: vec3<f32>, // albedo of the cooled crust, lit like ground
  emit: vec3<f32>,  // incandescent light, added unlit
};

struct CrustSample {
  crack: f32,    // 0..1 coverage of the glowing seam between plates
  plate: f32,    // plate id hash
  core: f32,     // 1 at the centre line of a seam
  inside: f32,   // distance from the seam into the plate
};

// One flow-map phase of the crust; seams widen with heat and noise makes some gape while others pinch shut.
fn lavaCrustLayer(q: vec2<f32>, heat: f32, aa: f32, t: f32) -> CrustSample {
  // Domain warp breaks the honeycomb regularity into ragged, uneven plates.
  let cells = crustCells(q + vec2<f32>(gradNoise(q * 0.6 + 2.3), gradNoise(q * 0.6 - 4.1)) * 0.35);
  let gape = 0.35 + 1.3 * smoothstep(-0.6, 0.6, gradNoise(q * 0.7 + vec2<f32>(t * 0.1, 5.0)));
  // Hot lava tears the crust apart: the seams swallow the plates until only small rafts drift on the melt.
  let open = smoothstep(0.5, 0.97, heat);
  let crackW = mix(0.012, 0.2, heat * heat) * gape + open * open * 0.5;
  var c: CrustSample;
  c.crack = 1.0 - smoothstep(crackW, crackW + aa, cells.x);
  c.plate = cells.y;
  c.core = clamp(1.0 - cells.x / max(crackW + aa, 1e-3), 0.0, 1.0);
  c.inside = cells.x - crackW;
  return c;
}

// Anti-aliasing width in crust-pattern units for a footprint of px grid cells per pixel.
fn aaOf(px: f32, scale: f32) -> f32 {
  return max(px * scale * 1.3, 0.01);
}

// Noise averaged along the flow (a short line integral): incandescent streaks drawn out downhill without shearing artefacts.
fn lavaStreaks(q: vec2<f32>, along: vec2<f32>) -> f32 {
  var s = 0.0;
  for (var k = -2; k <= 1; k++) {
    let tap = q + along * (f32(k) + 0.5);
    s += gradNoise(tap) + 0.45 * gradNoise(tap * 2.3 + 5.1); // finer octave reads as ropy skin on the melt
  }
  return s * 0.4;
}

// p grid coords, depth lava depth, slope smoothed lava surface gradient (flows downhill), px grid cells per pixel.
fn shadeLava(p: vec2<f32>, depth: f32, slopeGrad: vec2<f32>, t: f32, px: f32) -> LavaShade {
  let slope = length(slopeGrad);
  let downhill = select(vec2<f32>(0.0), -slopeGrad / max(slope, 1e-4), slope > 1e-4);
  // Viscous flow: faster when deep and steep; fast lava tears its crust open and runs hotter.
  let speed = clamp(slope * (0.4 + depth) * 4.0, 0.0, 3.0);
  let fast = smoothstep(0.3, 2.0, speed);
  let flicker = gradNoise(p * 0.5 + vec2<f32>(t * 0.8, -t * 0.6)) * 0.6 + gradNoise(p * 1.4 - t * 1.1) * 0.3;
  // Deep, still pools churn: slow upwellings split the crust open in drifting hot patches.
  let pool = smoothstep(0.6, 2.2, depth) * (1.0 - fast);
  let upwell = smoothstep(0.2, 0.75, gradNoise(p * 0.13 + vec2<f32>(t * 0.03, -t * 0.02) + 3.7)) * pool;
  // Freshly poured lava (brush or crater) is white-hot at the vent and still glowing as it sheets away.
  let fresh = lavaFreshness(p);
  let heat = clamp(0.06 + smoothstep(0.05, 1.6, depth) * 0.48 + fast * 0.45 + upwell * 0.4 + fresh * 0.55 + flicker * 0.07, 0.0, 1.0);
  // Heat shimmer: the hot surface wobbles as if seen through rising air.
  let haze = vec2<f32>(gradNoise(p * 0.7 + vec2<f32>(0.0, t * 2.3)), gradNoise(p * 0.7 + vec2<f32>(4.1, -t * 1.9)));
  let ps = p + haze * 0.22 * heat;
  // Flow-map advection (two phases cross-faded) so plates drift downhill without stretching over time.
  let scale = 0.25;
  // Pools have no downhill, so a slow broad convection drift keeps their crust moving.
  let convect = vec2<f32>(gradNoise(p * 0.05 + 1.3), gradNoise(p * 0.05 - 7.9)) * 0.9 * pool;
  let flow = downhill * (0.5 + 0.5 * speed) * 1.8 + convect;
  let phaseA = fract(t * 0.16);
  let phaseB = fract(t * 0.16 + 0.5);
  // Sharpened cross-fade: each phase shows one crisp crust most of the time instead of a busy double exposure.
  let wA = smoothstep(0.2, 0.8, 1.0 - abs(1.0 - 2.0 * phaseA));
  let aa = aaOf(px, scale);
  let pa = ps - flow * phaseA;
  let pb = ps - flow * phaseB + vec2<f32>(8.8, 3.1);
  let a = lavaCrustLayer(pa * scale, heat, aa, t);
  let b = lavaCrustLayer(pb * scale, heat, aa, t);
  let crack = mix(b.crack, a.crack, wA);
  let plate = mix(b.plate, a.plate, wA);
  let core = mix(b.core, a.core, wA);
  let inside = mix(b.inside, a.inside, wA);
  var streak = 0.0;
  if (speed > 0.2) {
    let along = downhill * 0.75;
    streak = mix(lavaStreaks(pb * 0.55, along), lavaStreaks(pa * 0.55, along), wA) * smoothstep(0.2, 1.2, speed);
  }
  let molten = crack;
  // Hottest far from any crust: narrow seams peak on their centre line, open melt plateaus away from the rafts.
  let seam = mix(core * core, smoothstep(0.0, 0.3, -inside), smoothstep(0.5, 0.97, heat));
  let meltHeat = clamp(0.3 + heat * 0.34 + seam * 0.26 + streak * 0.2 + flicker * 0.05, 0.0, 1.0);
  // Crust: near-black to silvery plates; thin plates and seam rims still glow red.
  // Grain rides with the dominant phase so the texture moves with its plate.
  let grain = gradNoise(select(pb, pa, wA > 0.5) * 2.6 + plate * 13.0) * 0.5 + 0.5;
  let crustAlbedo = mix(vec3<f32>(0.045, 0.04, 0.04), vec3<f32>(0.19, 0.18, 0.18), plate * 0.5 + grain * 0.35);
  let thinPlate = smoothstep(0.8, 1.0, plate * 0.6 + heat * 0.45);
  let rim = 1.0 - smoothstep(0.0, 0.07 + aa, inside);
  let crustGlow = lavaHeatColor(0.12 + 0.22 * heat) * thinPlate * 0.55
                + lavaHeatColor(0.2 + 0.25 * heat) * rim * (0.3 + 0.6 * heat);
  // Thin margins have cooled: dimmer, redder (unless still being fed).
  let margin = max(smoothstep(0.03, 0.35, depth), fresh);
  var shade: LavaShade;
  shade.crust = crustAlbedo * (1.0 - molten);
  shade.emit = (lavaHeatColor(meltHeat * mix(0.6, 1.0, margin)) * molten + crustGlow * (1.0 - molten)) * mix(0.6, 1.0, margin);
  return shade;
}

fn lavaCoverage(depth: f32) -> f32 {
  return smoothstep(0.02, 0.1, depth);
}
`;
