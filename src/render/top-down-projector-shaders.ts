// WGSL for the projector view: one full-screen triangle, the grid stretched over the whole target.
import { SHADING_COMMON_WGSL } from './shading-common-wgsl';

const TOP_DOWN_ENTRY_WGSL = /* wgsl */ `
struct TopDownVsOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vsTopDown(@builtin(vertex_index) vid: u32) -> TopDownVsOut {
  let xy = vec2<f32>(f32((vid << 1u) & 2u), f32(vid & 2u));
  var result: TopDownVsOut;
  result.clip = vec4<f32>(xy * 2.0 - 1.0, 0.0, 1.0);
  result.uv = vec2<f32>(xy.x, 1.0 - xy.y); // uv.y = 0 at the top = grid row 0 (north)
  return result;
}

// Water over the (already coloured) ground: depth tint, caustics, flow ripples, glints, foam and rain rings.
fn shadeWaterTopDown(ground: vec3<f32>, p: vec2<f32>, depth: f32, sea: f32, surfGrad: vec2<f32>, flow: vec2<f32>,
                     rain: f32, t: f32, px: f32) -> vec3<f32> {
  let waveStrength = smoothstep(0.0, 0.35, depth);
  let slope = surfGrad * 1.5 * smoothstep(0.05, 0.8, depth) + flowWaveGradient(p, flow, t) * 0.8 * waveStrength;
  let n = normalize(vec3<f32>(-slope.x, -slope.y, 1.0));
  let lightDir = normalize(vec3<f32>(-0.55, -0.75, 1.0));
  let halfDir = normalize(lightDir + vec3<f32>(0.0, 0.0, 1.0));
  let spec = pow(max(dot(n, halfDir), 0.0), 110.0) * 0.6 * waveStrength;
  let sheen = pow(max(dot(n, halfDir), 0.0), 12.0) * 0.1 * waveStrength;
  let caust = caustics(p, t) * exp(-depth * 0.45) * waveStrength;
  let bed = ground * vec3<f32>(0.72, 0.9, 0.98) * (1.0 + caust * 0.9);
  let body = waterColor(depth + sea * 1.6) * (0.86 + 0.28 * dot(n.xy, -lightDir.xy));
  // Thin films stay see-through; anything a village could drown in reads as solid blue.
  let opacity = smoothstep(0.02, 0.12, depth) * (0.45 + 0.5 * smoothstep(0.03, 0.3, depth));
  var col = mix(bed, body, opacity);
  let foam = foamAmount(p, flow, depth, t) * smoothstep(0.0, 0.06, depth);
  col = mix(col, vec3<f32>(0.93, 0.98, 1.0), foam * 0.85);
  col += vec3<f32>(1.0, 0.98, 0.9) * (spec * 0.95 + sheen);
  col += vec3<f32>(0.85, 0.95, 1.0) * rainRings(p, rain, t, px) * 0.45;
  return col;
}

@fragment
fn fsTopDown(input: TopDownVsOut) -> @location(0) vec4<f32> {
  // Quarter-turned map for portrait screens: west at the top, north on the right.
  let uv = select(input.uv, vec2<f32>(input.uv.y, 1.0 - input.uv.x), frame.effects.w > 0.5);
  let p = uv * frame.grid.xy - vec2<f32>(0.5);
  // Derivatives first: they must run in uniform control flow.
  let px = max(max(fwidth(p.x), fwidth(p.y)), 1e-4);
  let ts = terrainSmooth(p);
  let fwH = fwidth(ts.x);
  let t = frame.misc.y;

  var col = elevationColor(heightToUnit(ts.x));
  if (frame.misc.x > 0.5) {
    col *= hillshadeFactor(ts.yz, 2.6);
  }
  col = applyContours(col, contourLines(ts.x, frame.heightStyle.z, fwH) * seaContourFade(ts.x));

  let ws = waterSmooth(p);
  let depth = displayDepth(ws.x, ts.x);
  let sea = seaAmount(ws.x, ts.x);
  let rain = rainAmount(p);
  col *= 1.0 - 0.14 * rain; // wet sand darkens under rain
  col = shadeVillageHouses(p, px, t, col);
  if (depth > 0.003) {
    let surfGrad = (ts.yz + ws.yz) * (1.0 - sea);
    col = shadeWaterTopDown(col, p, depth, sea, surfGrad, flowVelocity(p, depth), rain, t, px);
  } else {
    col = mix(col, col * 0.55, rainRings(p, rain, t, px) * 0.7);
  }
  col = shadeSourceMarkers(p, px, t, col);
  col = shadeVillageRings(p, px, t, col);
  return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
`;

export const TOP_DOWN_PROJECTOR_WGSL = `${SHADING_COMMON_WGSL}\n${TOP_DOWN_ENTRY_WGSL}`;
