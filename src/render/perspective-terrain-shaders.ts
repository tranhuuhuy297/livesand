// WGSL for the 3D heightfield (one vertex per cell + box-wall skirts) and instanced village houses.

export const PERSPECTIVE_TERRAIN_WGSL = /* wgsl */ `
fn gridCellPos(cell: u32) -> vec2<f32> {
  let w = u32(frame.grid.x);
  return vec2<f32>(f32(cell % w), f32(cell / w));
}

// Same mapping as gridToWorld() in core/types.ts: grid centre at the origin, y up.
fn gridToWorld3(gp: vec2<f32>, y: f32) -> vec3<f32> {
  return vec3<f32>(gp.x - frame.grid.x * 0.5, y, gp.y - frame.grid.y * 0.5);
}

struct TerrainVsOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) gridPos: vec2<f32>,
  @location(1) world: vec3<f32>,
  @location(2) @interpolate(flat) skirt: f32,
  @location(3) lavaFx: vec4<f32>, // lava glow on nearby ground, steam where lava meets water, smoothed lava slope
};

// Vertex ids [0, cells) are the surface, [cells, 2*cells) the same cells dropped to the box floor.
@vertex
fn vsTerrain(@builtin(vertex_index) vid: u32) -> TerrainVsOut {
  let cells = u32(frame.grid.x) * u32(frame.grid.y);
  let isBottom = vid >= cells;
  let gp = gridCellPos(vid % cells);
  let surfaceY = terrainSmooth(gp).x * frame.heightStyle.w;
  let world = gridToWorld3(gp, select(surfaceY, min(frame.misc.w, surfaceY), isBottom));
  var result: TerrainVsOut;
  result.clip = frame.viewProj * vec4<f32>(world, 1.0);
  result.gridPos = gp;
  result.world = world;
  result.skirt = select(0.0, 1.0, isBottom);
  // Per vertex (one per cell) is plenty for these smooth fields and far cheaper than per pixel.
  result.lavaFx = vec4<f32>(0.0);
  if (!isBottom && lavaEnabled()) {
    result.lavaFx = lavaFxAt(vec2<i32>(gp));
  }
  return result;
}

@fragment
fn fsTerrain(input: TerrainVsOut) -> @location(0) vec4<f32> {
  let fwP = fwidth(input.gridPos);
  let px = max(max(fwP.x, fwP.y), 1e-4);
  let ts = terrainSmooth(input.gridPos);
  let fwH = fwidth(ts.x);
  let faceN = normalize(cross(dpdx(input.world), dpdy(input.world)));
  let t = frame.misc.y;
  let lavaOn = lavaEnabled();
  var col: vec3<f32>;
  if (input.skirt > 0.5) {
    let wallN = faceTowardEye(faceN, input.world);
    let strata = strataColor(input.world.y, input.gridPos);
    // A little camera-side fill keeps the shaded box walls from going muddy.
    let fill = max(dot(wallN, normalize(frame.eye.xyz - input.world)), 0.0) * 0.28;
    col = lightSurface(strata, wallN) + strata * fill;
    if (lavaOn) {
      col = lavaWallSection(col, input.gridPos, ts.x, input.world.y / frame.heightStyle.w, wallN, t);
    }
  } else {
    let vs = frame.heightStyle.w;
    var lava = 0.0;
    var rock = 0.0;
    if (lavaOn) {
      lava = lavaSmooth(input.gridPos).x;
      rock = rockBilinear(input.gridPos);
    }
    let lavaCover = lavaCoverage(lava);
    let rockCover = basaltCoverage(rock) * (1.0 - lavaCover);
    var albedo = elevationColor(heightToUnit(ts.x));
    var grad = ts.yz;
    if (rockCover > 0.0) {
      let basalt = basaltSurface(input.gridPos, px);
      albedo = mix(albedo, basalt.albedo, rockCover);
      grad += basalt.bump * rockCover / vs; // bumps are true heights, so undo the vertical exaggeration
    }
    let n = normalize(vec3<f32>(-grad.x * vs, 1.0, -grad.y * vs));
    albedo = applyContours(albedo, contourLines(ts.x, frame.heightStyle.z, fwH) * seaContourFade(ts.x) * (1.0 - lavaCover));
    let rain = rainAmount(input.gridPos) * (1.0 - lavaCover);
    albedo *= 1.0 - 0.14 * rain;
    albedo = mix(albedo, albedo * 0.55, rainRings(input.gridPos, rain, t, px) * 0.6);
    var sunVisible = 1.0;
    if (frame.misc.x > 0.5) {
      sunVisible = terrainSunVisibility(input.gridPos, ts.x);
    }
    var lit = lightSurfaceShadowed(albedo, n, sunVisible);
    lit = applyLavaGlow(lit, albedo, input.lavaFx.x * (1.0 - lavaCover), 1.3);
    if (lavaCover > 0.0) {
      // Crust is lit like ground; the incandescent part is pure emission (no sun, no shadow).
      let molten = shadeLava(input.gridPos, lava, input.lavaFx.zw, t, px);
      let smoothN = normalize(vec3<f32>(-ts.y * vs, 1.0, -ts.z * vs));
      // Fresh crust is glassy: a soft sun sheen on the dark plates (crust albedo is zero where the lava is molten).
      let halfDir = normalize(sunDir() + normalize(frame.eye.xyz - input.world));
      let sheen = pow(max(dot(smoothN, halfDir), 0.0), 36.0) * 1.3 * sunVisible * (1.0 - 0.7 * frame.effects.y);
      let crustLit = lightSurfaceShadowed(molten.crust, smoothN, sunVisible) + vec3<f32>(0.85, 0.85, 0.9) * sheen * molten.crust.g;
      lit = mix(lit, crustLit + molten.emit, lavaCover);
    }
    let steam = steamWisps(input.gridPos, input.lavaFx.y, input.lavaFx.x, t);
    // Ground-hugging vapour only off the lava; over it the rising plumes carry the steam.
    lit = mix(lit, steam.rgb, steam.a * 0.5 * (1.0 - lavaCover));
    // Markers after lighting so they read as glowing rings on shaded slopes.
    col = shadeVillageRings(input.gridPos, px, t, shadeSourceMarkers(input.gridPos, px, t, lit));
  }
  return vec4<f32>(applyFog(col, input.world), 1.0);
}

struct HouseVsOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) @interpolate(flat) part: f32,
  @location(3) @interpolate(flat) village: u32,
};

// Instance = (village, house slot); the unit house mesh is rotated, scaled and planted on the terrain.
@vertex
fn vsHouse(@location(0) pos: vec3<f32>, @location(1) nrm: vec3<f32>, @location(2) part: f32,
           @builtin(instance_index) inst: u32) -> HouseVsOut {
  let vi = min(inst / HOUSES_PER_VILLAGE, 15u);
  let slot = houseSlot(inst % HOUSES_PER_VILLAGE);
  let v = frame.villages[vi];
  let size = slot.w * v.z;
  let centre = v.xy + slot.xy * v.z;
  let groundY = terrainSmooth(centre).x * frame.heightStyle.w;
  let xz = rotate2(pos.xz * size, slot.z);
  let world = gridToWorld3(centre + xz, groundY + pos.y * size);
  let nxz = rotate2(nrm.xz, slot.z);
  var result: HouseVsOut;
  result.clip = frame.viewProj * vec4<f32>(world, 1.0);
  result.world = world;
  result.normal = vec3<f32>(nxz.x, nrm.y, nxz.y);
  result.part = part;
  result.village = vi;
  return result;
}

@fragment
fn fsHouse(input: HouseVsOut) -> @location(0) vec4<f32> {
  let v = frame.villages[input.village];
  let pulse = villagePulse(v.w, frame.misc.y);
  var albedo = vec3<f32>(0.95, 0.91, 0.82);
  if (input.part > 0.5) {
    albedo = roofColor(1.0, v.w, pulse) * 0.92;
  } else if (v.w > 1.5) {
    albedo *= 0.55;
  }
  var col = lightSurface(albedo, normalize(input.normal));
  col += villageStateColor(v.w) * pulse * 0.3 * input.part;
  return vec4<f32>(applyFog(col, input.world), 1.0);
}
`;
