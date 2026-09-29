// WGSL: village markers — state rings with flood-progress arcs and top-down rooftops.

/** Houses drawn per village (2D rooftops and 3D instanced houses share the same slots). */
export const HOUSES_PER_VILLAGE = 4;

export const VILLAGE_MARKER_WGSL = /* wgsl */ `
const HOUSES_PER_VILLAGE: u32 = ${HOUSES_PER_VILLAGE}u;

// House slot: offset (in village radii), yaw (radians), footprint length (in village radii).
fn houseSlot(j: u32) -> vec4<f32> {
  var slots = array<vec4<f32>, 4>(
    vec4<f32>(-0.36, -0.20, 0.30, 0.46),
    vec4<f32>(0.34, -0.30, -0.42, 0.40),
    vec4<f32>(-0.10, 0.36, 0.12, 0.42),
    vec4<f32>(0.40, 0.24, 0.65, 0.34),
  );
  return slots[min(j, 3u)];
}

fn villageStateColor(state: f32) -> vec3<f32> {
  if (state < 0.5) {
    return vec3<f32>(0.25, 0.96, 0.45);
  }
  if (state > 1.1 && state < 1.5) {
    return vec3<f32>(1.0, 0.3, 0.12);
  }
  if (state < 1.5) {
    return vec3<f32>(1.0, 0.58, 0.08);
  }
  return vec3<f32>(0.98, 0.17, 0.15);
}

// Flooding villages throb so the player's eye goes straight to them.
fn villagePulse(state: f32, t: f32) -> f32 {
  return select(0.0, 0.5 + 0.5 * sin(t * 7.5), state > 0.5 && state < 1.5);
}

fn rotate2(v: vec2<f32>, a: f32) -> vec2<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec2<f32>(c * v.x - s * v.y, s * v.x + c * v.y);
}

fn sdBox2(q: vec2<f32>, b: vec2<f32>) -> f32 {
  let d = abs(q) - b;
  return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
}

fn roofColor(litSide: f32, state: f32, pulse: f32) -> vec3<f32> {
  var roof = mix(vec3<f32>(0.60, 0.21, 0.13), vec3<f32>(0.92, 0.42, 0.26), litSide);
  roof = mix(roof, vec3<f32>(1.0, 0.62, 0.2), 0.35 * pulse);
  if (state > 1.5) {
    roof = vec3<f32>(dot(roof, vec3<f32>(0.3, 0.5, 0.2))) * vec3<f32>(0.55, 0.5, 0.52);
  }
  return roof;
}

// Top-down rooftops with soft drop shadows; drawn before water so flooded houses look submerged.
fn shadeVillageHouses(p: vec2<f32>, px: f32, t: f32, base: vec3<f32>) -> vec3<f32> {
  var col = base;
  let count = min(u32(frame.misc.z), 16u);
  for (var i = 0u; i < count; i++) {
    let v = frame.villages[i];
    let rel = p - v.xy;
    if (dot(rel, rel) > v.z * v.z * 1.4) {
      continue;
    }
    let pulse = villagePulse(v.w, t);
    for (var j = 0u; j < HOUSES_PER_VILLAGE; j++) {
      let slot = houseSlot(j);
      let size = slot.w * v.z;
      let halfSize = vec2<f32>(0.5, 0.34) * size;
      let q = rotate2(rel - slot.xy * v.z, -slot.z);
      let shadowQ = rotate2(rel - slot.xy * v.z - vec2<f32>(0.16, 0.22) * size, -slot.z);
      let shadow = 1.0 - smoothstep(-px, px + size * 0.14, sdBox2(shadowQ, halfSize));
      col = mix(col, col * 0.4, shadow * 0.65);
      let sd = sdBox2(q, halfSize);
      let cover = 1.0 - smoothstep(-px * 0.5, px * 0.5, sd);
      var roof = roofColor(select(0.0, 1.0, q.y < 0.0), v.w, pulse);
      let ridge = 1.0 - smoothstep(0.0, max(px, size * 0.035), abs(q.y));
      roof = mix(roof, roof * 0.6, ridge);
      roof *= 0.7 + 0.3 * smoothstep(0.0, max(px * 1.5, size * 0.06), -sd);
      col = mix(col, roof, cover);
    }
  }
  return col;
}

// State ring (green safe / pulsing orange flooding / red lost) with a dark halo and a flood-progress arc.
fn shadeVillageRings(p: vec2<f32>, px: f32, t: f32, base: vec3<f32>) -> vec3<f32> {
  var col = base;
  let count = min(u32(frame.misc.z), 16u);
  for (var i = 0u; i < count; i++) {
    let v = frame.villages[i];
    let rel = p - v.xy;
    let d = length(rel);
    let pulse = villagePulse(v.w, t);
    let halfW = max(max(0.55, v.z * 0.07), px * 1.1) * (1.0 + 0.5 * pulse);
    let ringDist = abs(d - v.z);
    let reach = halfW + max(1.8, px * 5.0);
    if (ringDist > reach && d > v.z) {
      continue;
    }
    let stateCol = villageStateColor(v.w);
    let inside = 1.0 - smoothstep(v.z - px, v.z + px, d);
    let lost = select(0.0, 1.0, v.w > 1.5);
    // A flooding village throbs orange across its whole disc (water included) so the threat is unmissable.
    col = mix(col, stateCol * (1.0 - 0.5 * lost), inside * (0.07 + 0.3 * pulse + 0.2 * lost));
    let halo = 1.0 - smoothstep(halfW, reach, ringDist);
    col = mix(col, col * 0.18, halo * 0.55);
    let ring = 1.0 - smoothstep(halfW - px, halfW + px, ringDist);
    col = mix(col, stateCol * (1.0 + 0.3 * pulse), ring);
    let flood = clamp(frame.villageInfo[i].x, 0.0, 1.0);
    let a01 = fract(atan2(rel.x, -rel.y) / 6.2831853 + 1.0);
    // Progress arc only while flooding; a lost village is simply solid red.
    let arc = (1.0 - smoothstep(flood - 0.004, flood + 0.004, a01)) * step(0.001, flood) * select(0.0, 1.0, v.w > 0.5 && v.w < 1.5);
    let arcLine = 1.0 - smoothstep(halfW * 0.35, halfW * 0.35 + px, ringDist);
    col = mix(col, vec3<f32>(1.0, 0.97, 0.92), arcLine * arc);
  }
  return col;
}
`;
