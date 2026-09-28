// Streams LSD1 depth frames of a believable sandbox to a relay: a slightly rotated box with walls, sculpted sand
// (a ridge, hills, a dug lake and a channel) and an optional hand hovering over it, as an iPhone above the box would see.
import { WebSocket } from 'ws';
import { DepthFormat, encodeDepthFrame } from '../../dist-server/depth-frame-encoder.js';

export const DEPTH_SIZE = { width: 256, height: 192 };
const FLAT_SAND_M = 1.0; // phone 1 m above the flat sand
const FLOOR_M = 1.12; // the table the box stands on
const RIM_M = 0.9; // top edge of the box walls, 10 cm above the flat sand
const WALL_UV = 0.035; // wall thickness as a fraction of the box
const HAND_M = 0.55; // a hand hovering 45 cm above the sand

// Inner sandbox corners (TL, TR, BR, BL) in depth pixels: a parallelogram, the phone being a little rotated.
const TL = { x: 21, y: 16 };
const TR = { x: 237, y: 23 };
const BL = { x: 15, y: 172 };
export const SANDBOX_CORNERS = [TL, TR, { x: TR.x + BL.x - TL.x, y: TR.y + BL.y - TL.y }, BL];

const gauss = (u, v, cu, cv, su, sv) => Math.exp(-(((u - cu) / su) ** 2 + ((v - cv) / sv) ** 2) / 2);

/** Distance from (u, v) to the polyline, in box units. */
function distanceToPath(u, v, path) {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const [a, b] = [path[i - 1], path[i]];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((u - a[0]) * dx + (v - a[1]) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(u - a[0] - t * dx, v - a[1] - t * dy));
  }
  return best;
}

const CHANNEL = [[0.64, 0.36], [0.58, 0.5], [0.5, 0.58], [0.42, 0.64]];

/** Sand height above flat (m) at box coordinates u, v in 0..1: what a few minutes of play leave behind. */
export function sandHeightMeters(u, v) {
  // The surface falls gently towards the dug lake, so rain gathers there instead of along the walls.
  let h = 0.035 * Math.min(1, Math.hypot(u - 0.34, v - 0.72) / 0.7);
  h += 0.17 * gauss(u, v, 0.74, 0.28, 0.13, 0.12); // main ridge
  h += 0.1 * gauss(u, v, 0.9, 0.62, 0.08, 0.12); // eastern shoulder
  h += 0.09 * gauss(u, v, 0.2, 0.26, 0.1, 0.09); // western hill
  h += 0.05 * gauss(u, v, 0.12, 0.82, 0.07, 0.07); // small mound
  h -= 0.09 * gauss(u, v, 0.34, 0.72, 0.1, 0.075); // dug lake
  h -= 0.05 * gauss(u, v, 0.62, 0.86, 0.07, 0.05); // second pond
  h -= 0.03 * Math.exp(-((distanceToPath(u, v, CHANNEL) / 0.03) ** 2)); // channel from the ridge to the lake
  h += 0.004 * Math.sin(u * 37 + v * 11) * Math.sin(v * 29 - u * 7); // hand-smoothed sand is never perfect
  return Math.max(-0.12, Math.min(0.2, h));
}

// Inverse of p = TL + u * (TR - TL) + v * (BL - TL).
const [ax, ay, bx, by] = [TR.x - TL.x, TR.y - TL.y, BL.x - TL.x, BL.y - TL.y];
const det = ax * by - ay * bx;
const toBox = (x, y) => [((x - TL.x) * by - (y - TL.y) * bx) / det, (ax * (y - TL.y) - ay * (x - TL.x)) / det];

/** Hand (palm + fingers) centred on box coords `hand`, with its forearm reaching in over the wall. */
function isHand(u, v, hand) {
  const du = (u - hand.u) * 1.33;
  const dv = v - hand.v;
  if ((du / 0.075) ** 2 + (dv / 0.085) ** 2 <= 1) return true; // palm
  // Fingers point north, spreading a little; the thumb points west.
  for (const [fu, fv, len, lean] of [[-0.062, -0.045, 0.09, -0.25], [-0.022, -0.07, 0.11, -0.08], [0.018, -0.07, 0.11, 0.06], [0.056, -0.052, 0.09, 0.22]]) {
    const t = Math.max(0, Math.min(1, -(dv - fv) / len));
    if (Math.hypot(du - fu - lean * t * len, dv - fv + t * len) < 0.015) return true;
  }
  const tt = Math.max(0, Math.min(1, -(du + 0.07) / 0.07));
  if (Math.hypot(du + 0.07 + tt * 0.07, dv - 0.015 + tt * 0.03) < 0.017) return true;
  // Forearm from the wrist out of the box along `hand.arm` (a unit vector in box units); none for a hand held high.
  if (!hand.arm) return false;
  const [ax, ay] = hand.arm;
  const along = (u - hand.u) * ax + (v - hand.v) * ay;
  return along > 0.04 && Math.abs((u - hand.u) * ay - (v - hand.v) * ax) < 0.05;
}

/** Depth image (uint16 mm, row 0 = top) for `scene` = { hands: [{ u, v, arm? }] }. */
export function renderDepthMillimeters(scene, out = new Uint16Array(DEPTH_SIZE.width * DEPTH_SIZE.height)) {
  const { width, height } = DEPTH_SIZE;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [u, v] = toBox(x + 0.5, y + 0.5);
      let d;
      if (u < -WALL_UV || u > 1 + WALL_UV || v < -WALL_UV || v > 1 + WALL_UV) d = FLOOR_M;
      else if (u < 0 || u > 1 || v < 0 || v > 1) d = RIM_M;
      else d = FLAT_SAND_M - sandHeightMeters(u, v);
      if (scene.hands.some((hand) => isHand(u, v, hand))) d = HAND_M;
      out[y * width + x] = Math.round(d * 1000);
    }
  }
  return out;
}

/** Connects as the relay's depth source and streams the (mutable) `scene` at `fps` until stop(). */
export function startSyntheticSandboxSource(url, scene, { fps = 20 } = {}) {
  const ws = new WebSocket(url);
  ws.on('error', (err) => console.warn(`[synthetic-source] ${err.message}`));
  const pixels = new Uint16Array(DEPTH_SIZE.width * DEPTH_SIZE.height);
  let frameIndex = 0;
  const timer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 1 << 20) return;
    renderDepthMillimeters(scene, pixels);
    const frame = encodeDepthFrame({ ...DEPTH_SIZE, format: DepthFormat.Uint16Millimeters, timestampMs: Date.now(), frameIndex: frameIndex++, data: pixels });
    ws.send(frame, { binary: true });
  }, 1000 / fps);
  return {
    stop() {
      clearInterval(timer);
      ws.close();
    },
  };
}
