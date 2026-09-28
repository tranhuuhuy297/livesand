// WGSL for the 3D water surface (alpha-blended second pass) including glass-like side walls at the box edges.

export const PERSPECTIVE_WATER_WGSL = /* wgsl */ `
struct WaterVsOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) gridPos: vec2<f32>,
  @location(1) world: vec3<f32>,
  @location(2) @interpolate(flat) skirt: f32,
};

// Vertex ids: [0, cells) surface, [cells, 2*cells) wall bottom (terrain), [2*cells, 3*cells) wall top (surface).
@vertex
fn vsWater(@builtin(vertex_index) vid: u32) -> WaterVsOut {
  let cells = u32(frame.grid.x) * u32(frame.grid.y);
  let kind = vid / cells;
  let gp = gridCellPos(vid % cells);
  let ground = terrainSmooth(gp).x;
  let depth = waterSmooth(gp).x;
  var h = ground + depth;
  if (kind == 0u && depth < 0.02) {
    h = ground - 0.6; // dry vertices sink under the terrain so shorelines are cut by the depth test
  }
  if (kind == 1u) {
    h = ground;
  }
  let world = gridToWorld3(gp, h * frame.heightStyle.w);
  var result: WaterVsOut;
  result.clip = frame.viewProj * vec4<f32>(world, 1.0);
  result.gridPos = gp;
  result.world = world;
  result.skirt = select(0.0, 1.0, kind == 1u);
  return result;
}

@fragment
fn fsWater(input: WaterVsOut) -> @location(0) vec4<f32> {
  let fwP = fwidth(input.gridPos);
  let px = max(max(fwP.x, fwP.y), 1e-4);
  let faceN = normalize(cross(dpdx(input.world), dpdy(input.world)));
  let ws = waterSmooth(input.gridPos);
  let depth = ws.x;
  let isSkirt = input.skirt > 0.5;
  if (!isSkirt && depth < 0.004) {
    discard;
  }
  let ts = terrainSmooth(input.gridPos);
  let t = frame.misc.y;
  let flow = flowVelocity(input.gridPos, depth);
  let toEye = frame.eye.xyz - input.world;
  let viewDir = normalize(toEye);
  // Ripples fade with distance (px = cells per pixel) so far water doesn't shimmer into noise.
  let waveStrength = select(smoothstep(0.0, 0.35, depth) * (1.0 - smoothstep(0.3, 0.9, px)), 0.0, isSkirt);
  // Near the shore the smoothed surface follows the bank; flatten it there so edges don't look like raised gel.
  let settled = smoothstep(0.05, 0.8, depth);
  let slope = (ts.yz + ws.yz) * frame.heightStyle.w * settled + flowWaveGradient(input.gridPos, flow, t) * 0.6 * waveStrength;
  let n = select(normalize(vec3<f32>(-slope.x, 1.0, -slope.y)), faceTowardEye(faceN, input.world), isSkirt);

  let sun = sunDir();
  let ndv = max(dot(n, viewDir), 0.0);
  let fresnel = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
  let refl = skyColor(reflect(-viewDir, n));
  let spec = pow(max(dot(n, normalize(sun + viewDir)), 0.0), 320.0) * 2.2 * waveStrength;
  // Camera-relative glint light ~20 degrees below the mirror direction: flat water never glares, ripples sparkle.
  let ahead = vec2<f32>(-viewDir.x, -viewDir.z);
  let aheadDir = select(vec2<f32>(0.0, -1.0), normalize(ahead), length(ahead) > 1e-3);
  let glintElev = asin(clamp(viewDir.y, -1.0, 1.0)) - 0.36;
  let glintDir = vec3<f32>(aheadDir.x * cos(glintElev), sin(glintElev), aheadDir.y * cos(glintElev));
  let glint = pow(max(dot(n, normalize(glintDir + viewDir)), 0.0), 900.0) * 1.2 * waveStrength;
  let bodyDepth = select(depth, max(depth, 4.0), isSkirt);
  let body = waterColor(bodyDepth) * (0.62 + 0.42 * max(dot(n, sun), 0.0));
  var col = mix(body, refl, fresnel * 0.65);
  let foam = foamAmount(input.gridPos, flow, depth, t) * smoothstep(0.0, 0.06, depth) * (1.0 - input.skirt);
  col = mix(col, vec3<f32>(0.95, 0.98, 1.0), foam * 0.8);
  let rain = 1.0 - exp(-emissionBilinear(input.gridPos) * 6.0);
  col += vec3<f32>(0.85, 0.95, 1.0) * rainRings(input.gridPos, rain, t, px) * 0.4 * (1.0 - input.skirt);
  col += vec3<f32>(1.0, 0.95, 0.85) * (spec + glint);

  var alpha = 0.5 + 0.42 * (1.0 - exp(-depth * 0.35));
  alpha = mix(alpha, 1.0, clamp(fresnel * 0.6 + foam * 0.7 + spec + glint, 0.0, 1.0));
  alpha = select(alpha * smoothstep(0.0, 0.12, depth), 0.7, isSkirt);
  // Village rings are re-drawn on the water so flooded villages stay readable.
  let ringed = shadeVillageRings(input.gridPos, px, t, col);
  alpha = mix(alpha, 1.0, clamp(length(ringed - col) * 3.0, 0.0, 1.0));
  return vec4<f32>(applyFog(ringed, input.world), alpha);
}
`;
