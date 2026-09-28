// WGSL: AR-sandbox elevation colormap, anti-aliased contour lines and hillshade.

export const TERRAIN_PALETTE_WGSL = /* wgsl */ `
// Classic AR-sandbox ramp: deep blue lows, green lowlands, sandy yellow, brown/red slopes, grey rock, snow caps.
fn elevationColor(t: f32) -> vec3<f32> {
  var stops = array<vec4<f32>, 12>(
    vec4<f32>(0.00, 0.04, 0.10, 0.33),
    vec4<f32>(0.10, 0.06, 0.25, 0.56),
    vec4<f32>(0.18, 0.12, 0.47, 0.73),
    vec4<f32>(0.24, 0.40, 0.72, 0.82),
    vec4<f32>(0.27, 0.13, 0.49, 0.33),
    vec4<f32>(0.37, 0.32, 0.62, 0.29),
    vec4<f32>(0.47, 0.64, 0.76, 0.35),
    vec4<f32>(0.57, 0.94, 0.85, 0.50),
    vec4<f32>(0.68, 0.87, 0.58, 0.27),
    vec4<f32>(0.79, 0.64, 0.30, 0.16),
    vec4<f32>(0.90, 0.58, 0.54, 0.52),
    vec4<f32>(1.00, 0.98, 0.98, 0.98),
  );
  let x = clamp(t, 0.0, 1.0);
  var col = stops[0].yzw;
  for (var i = 1; i < 12; i++) {
    let a = stops[i - 1];
    let b = stops[i];
    let k = clamp((x - a.x) / (b.x - a.x), 0.0, 1.0);
    col = select(col, mix(a.yzw, b.yzw, k * k * (3.0 - 2.0 * k)), x >= a.x);
  }
  return col;
}

// Returns (minor, major) line coverage; fwH = fwidth(height) so lines stay ~1.5px / 2.5px wide at any zoom.
fn contourLines(h: f32, interval: f32, fwH: f32) -> vec2<f32> {
  if (interval <= 0.0) {
    return vec2<f32>(0.0);
  }
  let v = h / interval;
  let fw = max(fwH / interval, 1e-5);
  let minorDist = abs(fract(v + 0.5) - 0.5) / fw;
  let minor = 1.0 - smoothstep(0.35, 1.2, minorDist);
  let v5 = v / 5.0;
  let majorDist = abs(fract(v5 + 0.5) - 0.5) / (fw / 5.0);
  let major = 1.0 - smoothstep(0.8, 1.9, majorDist);
  // Fade lines out where they would crowd into moire (steep walls, far away in 3D).
  let minorFade = 1.0 - smoothstep(0.18, 0.4, fw);
  let majorFade = 1.0 - smoothstep(0.18, 0.4, fw / 5.0);
  // Perfectly flat ground lying on a contour level (clamped sea floor, plateau) is an area, not a line.
  let flatFade = smoothstep(2e-4, 2e-3, fwH / interval);
  return vec2<f32>(minor * minorFade, major * majorFade) * flatFade;
}

fn applyContours(col: vec3<f32>, lines: vec2<f32>) -> vec3<f32> {
  let minorCol = mix(col, col * 0.3, lines.x * 0.7);
  return mix(minorCol, vec3<f32>(0.04, 0.03, 0.03), lines.y * 0.85);
}

// Soft relief shading from the height gradient (grid space, light from the north-west).
fn hillshadeFactor(grad: vec2<f32>, zScale: f32) -> f32 {
  let n = normalize(vec3<f32>(-grad.x * zScale, -grad.y * zScale, 1.0));
  let l = normalize(vec3<f32>(-0.6, -0.8, 1.1));
  let flatDot = l.z;
  let shade = max(dot(n, l), 0.0) / flatDot;
  return clamp(0.42 + 0.58 * shade, 0.35, 1.25);
}
`;
