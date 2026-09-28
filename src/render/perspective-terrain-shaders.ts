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
  var col: vec3<f32>;
  if (input.skirt > 0.5) {
    let wallN = faceTowardEye(faceN, input.world);
    let strata = strataColor(input.world.y, input.gridPos);
    // A little camera-side fill keeps the shaded box walls from going muddy.
    let fill = max(dot(wallN, normalize(frame.eye.xyz - input.world)), 0.0) * 0.28;
    col = lightSurface(strata, wallN) + strata * fill;
  } else {
    let vs = frame.heightStyle.w;
    let n = normalize(vec3<f32>(-ts.y * vs, 1.0, -ts.z * vs));
    var albedo = elevationColor(heightToUnit(ts.x));
    albedo = applyContours(albedo, contourLines(ts.x, frame.heightStyle.z, fwH) * seaContourFade(ts.x));
    let rain = rainAmount(input.gridPos);
    albedo *= 1.0 - 0.14 * rain;
    albedo = mix(albedo, albedo * 0.55, rainRings(input.gridPos, rain, t, px) * 0.6);
    var sunVisible = 1.0;
    if (frame.misc.x > 0.5) {
      sunVisible = terrainSunVisibility(input.gridPos, ts.x);
    }
    // Markers after lighting so they read as glowing rings on shaded slopes.
    let lit = shadeSourceMarkers(input.gridPos, px, t, lightSurfaceShadowed(albedo, n, sunVisible));
    col = shadeVillageRings(input.gridPos, px, t, lit);
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
