// Viewer-side relay connection: decodes LSD1 frames, keeps only the newest, estimates fps, reconnects with backoff.
import { decodeDepthFrame, type DepthFrame } from '../../core/depth-frame-protocol';

export type RelayConnectionState = 'connecting' | 'open' | 'closed';

export interface DepthStreamClientOptions {
  url: string;
  /** Connection, relay status, first-frame and frame-size changes (not every frame). */
  onChange?: () => void;
}

const RETRY_MIN_MS = 500;
const RETRY_MAX_MS = 8000;
const FPS_WINDOW_MS = 1000;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class DepthStreamClient {
  readonly url: string;
  private readonly onChange: () => void;
  private socket: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryMs = RETRY_MIN_MS;
  private nextRetryAt = 0;
  private running = false;
  private connState: RelayConnectionState = 'closed';
  private sourceCount = 0;
  private latest: DepthFrame | null = null;
  private seq = 0;
  private lastAt = 0;
  private readonly arrivals: number[] = [];
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
    const a = this.arrivals;
    while (a.length > 0 && now - a[0] > FPS_WINDOW_MS) a.shift();
    if (a.length < 2) return 0;
    return ((a.length - 1) * 1000) / Math.max(1, a[a.length - 1] - a[0]);
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
    const ws = this.socket;
    this.socket = null;
    if (ws) {
      ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
      try {
        ws.close(1000, 'viewer stopped');
      } catch {
        // Already closing; nothing else to release.
      }
    }
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
      this.onChange();
    };
    ws.onmessage = (ev: MessageEvent) => this.handleMessage(ev.data);
    ws.onerror = () => {
      this.error = `Cannot reach the relay at ${this.url}`;
    };
    ws.onclose = () => this.handleClose(ws);
    this.onChange();
  }

  private handleClose(ws: WebSocket): void {
    if (this.socket !== ws) return;
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
    const wasIdle = now - this.lastAt > FPS_WINDOW_MS;
    this.latest = frame;
    this.seq++;
    this.lastAt = now;
    this.arrivals.push(now);
    if (this.arrivals.length > 240) this.arrivals.shift();
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
