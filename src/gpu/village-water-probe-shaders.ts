// WGSL for VillageWaterProbe: one workgroup per probe reduces max water depth over the cells inside its circle.

export const PROBE_WORKGROUP_SIZE = 64;

/** Byte size of the ProbeParams uniform (width, height, count, pad). */
export const PROBE_PARAMS_BYTES = 16;

/** Bytes per probe record: vec4<f32>(x, y, radius, unused). */
export const PROBE_RECORD_BYTES = 16;

export const PROBE_SHADER_WGSL = /* wgsl */ `
struct ProbeParams {
  width: u32,
  height: u32,
  count: u32,
  pad0: u32,
}

@group(0) @binding(0) var<uniform> params: ProbeParams;
@group(0) @binding(1) var<storage, read> water: array<f32>;
@group(0) @binding(2) var<storage, read> probes: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> results: array<f32>;

const WG: u32 = ${PROBE_WORKGROUP_SIZE}u;
var<workgroup> partial: array<f32, ${PROBE_WORKGROUP_SIZE}>;

@compute @workgroup_size(${PROBE_WORKGROUP_SIZE})
fn probeMain(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  let pi = wid.x;
  if (pi >= params.count) {
    return;
  }
  let p = probes[pi];
  let r = max(p.z, 0.0);
  let w = i32(params.width);
  let h = i32(params.height);
  // Cell (x, y) sits at integer grid coords; the bounding box is clamped to the grid.
  let x0 = max(i32(floor(p.x - r)), 0);
  let x1 = min(i32(ceil(p.x + r)), w - 1);
  let y0 = max(i32(floor(p.y - r)), 0);
  let y1 = min(i32(ceil(p.y + r)), h - 1);
  // The nearest cell always counts, so tiny radii still sample something.
  let nx = i32(floor(p.x + 0.5));
  let ny = i32(floor(p.y + 0.5));

  var m = 0.0;
  if (x0 <= x1 && y0 <= y1) {
    let bw = u32(x1 - x0 + 1);
    let n = bw * u32(y1 - y0 + 1);
    for (var k = lid; k < n; k += WG) {
      let cx = x0 + i32(k % bw);
      let cy = y0 + i32(k / bw);
      let dx = f32(cx) - p.x;
      let dy = f32(cy) - p.y;
      if (dx * dx + dy * dy <= r * r || (cx == nx && cy == ny)) {
        m = max(m, water[u32(cy * w + cx)]);
      }
    }
  }
  partial[lid] = m;
  workgroupBarrier();
  for (var s = WG / 2u; s > 0u; s = s / 2u) {
    if (lid < s) {
      partial[lid] = max(partial[lid], partial[lid + s]);
    }
    workgroupBarrier();
  }
  if (lid == 0u) {
    results[pi] = partial[0];
  }
}
`;
