// Viewer-side relay connection: decodes LSD1 frames, keeps only the newest, estimates fps, reconnects with backoff.
import { decodeDepthFrame, type DepthFrame } from '../../core/depth-frame-protocol';
import { FrameArrivalRateMeter } from './frame-arrival-rate-meter';
import { RelaySilenceWatchdog } from './relay-silence-watchdog';

export type RelayConnectionState = 'connecting' | 'open' | 'closed';

export interface DepthStreamClientOptions {
  url: string;
  /** Connection, relay status, first-frame and frame-size changes (not every frame). */
  onChange?: () => void;
}

const RETRY_MIN_MS = 500;
const RETRY_MAX_MS = 8000;
// A gap this long means the stream restarted, which is worth an onChange (status goes live again).
const IDLE_GAP_MS = 1000;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Silences a socket's handlers and closes it without waiting for (or reacting to) the close handshake. */
function detach(ws: WebSocket, code: number, reason: string): void {
  ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
  try {
    ws.close(code, reason);
  } catch {
    // Already closing; nothing else to release.
  }
}

export class DepthStreamClient {
  readonly url: string;
  private readonly onChange: () => void;
  private socket: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly watchdog = new RelaySilenceWatchdog(() => this.handleSilence());
  private retryMs = RETRY_MIN_MS;
  private nextRetryAt = 0;
  private running = false;
  private connState: RelayConnectionState = 'closed';
  private sourceCount = 0;
  private latest: DepthFrame | null = null;
  private seq = 0;
  private lastAt = 0;
  private readonly rate = new FrameArrivalRateMeter();
  private error: string | null = null;

  constructor(opts: DepthStreamClientOptions) {
    this.url = opts.url;
    this.onChange = opts.onChange ?? (() => {});
  }

  get state(): RelayConnectionState {
    return this.connState;
  }

  /** Depth sources connected to the relay, from its status broadcasts. */
  get sources(): number {
    return this.sourceCount;
  }

  get latestFrame(): DepthFrame | null {
    return this.latest;
  }

  /** Increments for every decoded frame; consumers compare it to skip frames they already handled. */
  get frameSeq(): number {
    return this.seq;
  }

  get lastFrameAtMs(): number {
    return this.lastAt;
  }

  get lastError(): string | null {
    return this.error;
  }

  /** Milliseconds until the next reconnect attempt, or null when not waiting. */
  get retryInMs(): number | null {
    return this.retryTimer ? Math.max(0, this.nextRetryAt - performance.now()) : null;
  }

  fps(now = performance.now()): number {
    return this.rate.fps(now);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.watchdog.stop();
    const ws = this.socket;
    this.socket = null;
    if (ws) detach(ws, 1000, 'viewer stopped');
    this.connState = 'closed';
    this.sourceCount = 0;
  }

  private connect(): void {
    this.retryTimer = null;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      // A malformed URL never becomes valid, so retrying would only spin.
      this.error = `Invalid relay URL ${this.url}: ${messageOf(err)}`;
      this.connState = 'closed';
      this.onChange();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.socket = ws;
    this.connState = 'connecting';
    ws.onopen = () => {
      this.retryMs = RETRY_MIN_MS;
      this.connState = 'open';
      this.error = null;
      this.watchdog.start();
      this.onChange();
    };
    ws.onmessage = (ev: MessageEvent) => {
      this.watchdog.heard();
      this.handleMessage(ev.data);
    };
    ws.onerror = () => {
      this.error = `Cannot reach the relay at ${this.url}`;
    };
    ws.onclose = () => this.handleClose(ws);
    this.onChange();
  }

  /** The link is dead even though the browser still reports it open: drop it and redial. */
  private handleSilence(): void {
    const ws = this.socket;
    if (!ws) return;
    this.error = `The relay at ${this.url} went silent; reconnecting`;
    detach(ws, 4000, 'no data from the relay');
    this.handleClose(ws);
  }

  private handleClose(ws: WebSocket): void {
    if (this.socket !== ws) return;
    this.watchdog.stop();
    this.socket = null;
    this.connState = 'closed';
    this.sourceCount = 0;
    if (this.running) {
      this.nextRetryAt = performance.now() + this.retryMs;
      this.retryTimer = setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
    }
    this.onChange();
  }

  private handleMessage(data: unknown): void {
    if (typeof data === 'string') {
      this.handleText(data);
      return;
    }
    if (!(data instanceof ArrayBuffer)) return;
    let frame: DepthFrame;
    try {
      frame = decodeDepthFrame(data);
    } catch (err) {
      this.error = `Dropped a bad depth frame: ${messageOf(err)}`;
      this.onChange();
      return;
    }
    const prev = this.latest;
    const now = performance.now();
    const wasIdle = now - this.lastAt > IDLE_GAP_MS;
    this.latest = frame;
    this.seq++;
    this.lastAt = now;
    this.rate.record(now);
    if (wasIdle || !prev || prev.width !== frame.width || prev.height !== frame.height) this.onChange();
  }

  private handleText(text: string): void {
    try {
      const msg = JSON.parse(text) as { type?: unknown; sources?: unknown };
      if (msg.type === 'status' && typeof msg.sources === 'number' && Number.isFinite(msg.sources)) {
        this.sourceCount = Math.max(0, Math.floor(msg.sources));
        this.onChange();
      }
    } catch {
      // The relay only sends JSON status; anything else is ignored rather than breaking the stream.
    }
  }
}
