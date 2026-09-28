import { WebSocket } from 'ws';
import { DepthFormat, encodeDepthFrame } from './depth-frame-encoder.js';

export interface FakeSourceOptions {
  url: string;
  fps?: number;
  width?: number;
  height?: number;
  log?: (m: string) => void;
}

const FLAT_SAND_MM = 1000;
const MOUND_HEIGHT_MM = 120;
const HAND_DEPTH_MM = 700;
const NOISE_MM = 2;
// Skip frames instead of queueing when the relay is slow: stale depth is worse than dropped depth.
const MAX_BUFFERED_BYTES = 1 << 20;
const RETRY_MIN_MS = 500;
const RETRY_MAX_MS = 5000;

/** Synthetic LiDAR depth (mm): flat sand, a slowly drifting mound, and a hand blob circling above the sand. */
export function synthesizeFakeDepth(width: number, height: number, tSec: number, out?: Uint16Array): Uint16Array {
  const depth = out ?? new Uint16Array(width * height);
  const minSide = Math.min(width, height);
  const moundX = width * (0.5 + 0.2 * Math.sin(tSec * 0.15));
  const moundY = height * (0.5 + 0.2 * Math.cos(tSec * 0.11));
  const sigma = minSide * 0.18;
  const inv2Sigma2 = 1 / (2 * sigma * sigma);
  const handX = width * (0.5 + 0.3 * Math.cos(tSec * 0.8));
  const handY = height * (0.5 + 0.3 * Math.sin(tSec * 0.8));
  const handR2 = (minSide * 0.08) ** 2;
  // Cheap xorshift noise seeded per frame so consecutive frames jitter like a real sensor.
  let seed = (Math.floor(tSec * 1000) * 2654435761) >>> 0 || 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const hx = x - handX;
      const hy = y - handY;
      if (hx * hx + hy * hy <= handR2) {
        depth[i] = HAND_DEPTH_MM;
        continue;
      }
      const mx = x - moundX;
      const my = y - moundY;
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const noise = (((seed >>> 0) % 1000) / 1000 - 0.5) * 2 * NOISE_MM;
      depth[i] = Math.round(FLAT_SAND_MM - MOUND_HEIGHT_MM * Math.exp(-(mx * mx + my * my) * inv2Sigma2) + noise);
    }
  }
  return depth;
}

function checkPositiveInt(name: string, value: number, max: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > max) throw new RangeError(`${name} must be an integer in 1..${max}`);
  return value;
}

/** Streams synthetic LSD1 uint16-mm frames to a relay source URL, reconnecting with backoff until stopped. */
export function startFakeDepthSource(opts: FakeSourceOptions): { stop(): void } {
  const fps = opts.fps ?? 30;
  if (!Number.isFinite(fps) || fps <= 0 || fps > 120) throw new RangeError('fps must be in (0, 120]');
  const width = checkPositiveInt('width', opts.width ?? 256, 4096);
  const height = checkPositiveInt('height', opts.height ?? 192, 4096);
  const protocol = new URL(opts.url).protocol; // throws TypeError on malformed URLs
  if (protocol !== 'ws:' && protocol !== 'wss:') throw new TypeError(`expected a ws:// or wss:// URL, got ${opts.url}`);
  const log = opts.log ?? (() => {});

  const pixels = new Uint16Array(width * height);
  const startMs = performance.now();
  let socket: WebSocket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let retryMs = RETRY_MIN_MS;
  let frameIndex = 0;
  let stopped = false;

  const connect = (): void => {
    reconnectTimer = null;
    const ws = new WebSocket(opts.url);
    socket = ws;
    ws.on('open', () => {
      retryMs = RETRY_MIN_MS;
      log(`fake depth source connected to ${opts.url} (${width}x${height} @ ${fps} fps)`);
    });
    ws.on('error', (err) => {
      if (!stopped) log(`fake depth source error: ${err.message}`);
    });
    ws.on('close', (code) => {
      if (socket === ws) socket = null;
      if (stopped) return;
      log(`fake depth source disconnected (code ${code}); retrying in ${retryMs} ms`);
      reconnectTimer = setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    });
  };

  const sendFrame = (): void => {
    const ws = socket;
    if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_BUFFERED_BYTES) return;
    synthesizeFakeDepth(width, height, (performance.now() - startMs) / 1000, pixels);
    const frame = encodeDepthFrame({
      width,
      height,
      format: DepthFormat.Uint16Millimeters,
      timestampMs: Date.now(),
      frameIndex: frameIndex++,
      data: pixels,
    });
    ws.send(frame, { binary: true }, (err) => {
      if (err && !stopped) log(`fake depth source send failed: ${err.message}`);
    });
  };

  connect();
  const frameTimer = setInterval(sendFrame, 1000 / fps);

  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      clearInterval(frameTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const ws = socket;
      socket = null;
      if (!ws) return;
      if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
      else ws.close(1000, 'fake source stopped');
    },
  };
}
