import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { MAX_DEPTH_FRAME_BYTES, lsd1FrameIndex } from './depth-frame-encoder.js';
import { DEFAULT_RELAY_LIMITS, RelayPeerLimits, type RelayLimits, type RelayRole } from './relay-peer-limits.js';

export type { RelayRole } from './relay-peer-limits.js';

// A lagging viewer gets frames dropped instead of an ever-growing queue (latency would explode).
export const MAX_VIEWER_BUFFERED_BYTES = 4 * 1024 * 1024;
export const KEEPALIVE_INTERVAL_MS = 5_000;
/** Close code sent to a source when a newer one connects; sources treat it as final (no reconnect). */
export const CLOSE_REPLACED_BY_NEWER_SOURCE = 4001;
// Every 3rd keepalive tick pings peers and reaps those that never answered the previous ping (15 s).
const TICKS_PER_PING = 3;
// Viewers never send anything today; a small cap stops them from making the relay buffer large messages.
const MAX_VIEWER_MESSAGE_BYTES = 4 * 1024;
const CLOSE_GRACE_MS = 1000;

export interface RelayHubOptions {
  log: (msg: string) => void;
  keepaliveMs?: number;
  limits?: RelayLimits;
}

const isRole = (role: string | null): role is RelayRole => role === 'source' || role === 'viewer';

/** One live depth source (newest wins) fanned out to viewers, with acks, keepalive status and dead-peer reaping. */
export class RelayWebSocketHub {
  private readonly sourceWss = new WebSocketServer({ noServer: true, maxPayload: MAX_DEPTH_FRAME_BYTES });
  private readonly viewerWss = new WebSocketServer({ noServer: true, maxPayload: MAX_VIEWER_MESSAGE_BYTES });
  private readonly viewers = new Set<WebSocket>();
  private readonly awaitingPong = new WeakSet<WebSocket>();
  private readonly limits: RelayPeerLimits;
  private readonly timer: NodeJS.Timeout;
  private readonly log: (msg: string) => void;
  private activeSource: WebSocket | null = null;
  private ticks = 0;
  private relayedCount = 0;

  constructor(opts: RelayHubOptions) {
    this.log = opts.log;
    this.limits = new RelayPeerLimits(opts.limits ?? DEFAULT_RELAY_LIMITS);
    this.timer = setInterval(() => this.tick(), opts.keepaliveMs ?? KEEPALIVE_INTERVAL_MS);
    this.timer.unref();
  }

  /** Frames from sources that reached at least one viewer. */
  get framesRelayed(): number {
    return this.relayedCount;
  }

  get sourceCount(): number {
    return this.activeSource ? 1 : 0;
  }

  get viewerCount(): number {
    return this.viewers.size;
  }

  /** Why an upgrade must be refused with 503, or null; peers with a bad role are let through to get a 1008 close. */
  refusal(role: string | null, address: string): string | null {
    return isRole(role) ? this.limits.refusal(role, address) : null;
  }

  /** Completes the WS handshake; peers without a valid role are closed with 1008 (policy violation). */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, role: string | null): void {
    const wss = role === 'source' ? this.sourceWss : this.viewerWss;
    wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws, role, req.socket.remoteAddress ?? 'unknown'));
  }

  private accept(ws: WebSocket, role: string | null, peer: string): void {
    ws.on('error', (err) => this.log(`websocket error from ${peer}: ${err.message}`));
    if (!isRole(role)) return ws.close(1008, 'role query param must be "source" or "viewer"');
    const refusal = this.limits.refusal(role, peer); // concurrent handshakes can race past the upgrade check
    if (refusal) return this.retire(ws, 1013, `relay is full: ${refusal}`);
    this.limits.add(role, peer);
    ws.on('close', () => this.limits.remove(role, peer));
    ws.on('pong', () => this.awaitingPong.delete(ws));
    if (role === 'source') this.acceptSource(ws, peer);
    else this.acceptViewer(ws, peer);
    this.broadcastStatus();
  }

  private acceptSource(ws: WebSocket, peer: string): void {
    const previous = this.activeSource;
    this.activeSource = ws;
    // Interleaving two cameras would mix two scenes (and sizes) into one terrain, so the newest one takes over.
    if (previous) this.retire(previous, CLOSE_REPLACED_BY_NEWER_SOURCE, 'replaced by a newer depth source');
    ws.on('message', (data, isBinary) => {
      if (isBinary && this.activeSource === ws) this.relay(ws, data);
    });
    ws.on('close', () => {
      if (this.activeSource !== ws) return;
      this.activeSource = null;
      this.log(`source disconnected (${peer}); viewers=${this.viewers.size}`);
      this.broadcastStatus();
    });
    // Tells the phone to pace frames on relay acks instead of on local send completion.
    ws.send(JSON.stringify({ type: 'hello', role: 'source', acks: true }));
    this.log(`source connected (${peer})${previous ? ', replacing the previous source' : ''}; viewers=${this.viewers.size}`);
  }

  private acceptViewer(ws: WebSocket, peer: string): void {
    this.viewers.add(ws);
    ws.on('close', () => {
      if (!this.viewers.delete(ws)) return;
      this.log(`viewer disconnected (${peer}); sources=${this.sourceCount} viewers=${this.viewers.size}`);
      this.broadcastStatus();
    });
    this.log(`viewer connected (${peer}); sources=${this.sourceCount} viewers=${this.viewers.size}`);
  }

  private relay(source: WebSocket, data: RawData): void {
    const payload = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
    const frameIndex = lsd1FrameIndex(payload);
    // Every message is acked, even a refused one, so the sender's flow control can never stall on it.
    source.send(JSON.stringify(frameIndex === null ? { type: 'ack' } : { type: 'ack', frameIndex }));
    if (frameIndex === null) return; // not a valid LSD1 frame within the size caps: never reaches viewers
    let delivered = false;
    for (const viewer of this.viewers) {
      if (viewer.readyState !== WebSocket.OPEN || viewer.bufferedAmount > MAX_VIEWER_BUFFERED_BYTES) continue;
      viewer.send(payload, { binary: true });
      delivered = true;
    }
    if (delivered) this.relayedCount++;
  }

  /** Closes politely but terminates soon: ws would otherwise keep a silent peer (and its buffers) for 30 s. */
  private retire(ws: WebSocket, code: number, reason: string): void {
    ws.close(code, reason);
    const kill = setTimeout(() => ws.terminate(), CLOSE_GRACE_MS);
    kill.unref();
    ws.once('close', () => clearTimeout(kill));
  }

  private broadcastStatus(): void {
    const message = JSON.stringify({ type: 'status', sources: this.sourceCount, viewers: this.viewers.size });
    for (const viewer of this.viewers) {
      if (viewer.readyState === WebSocket.OPEN) viewer.send(message);
    }
  }

  private tick(): void {
    if (++this.ticks % TICKS_PER_PING === 0) this.heartbeat();
    // Browsers can't see pings, so this periodic status is how viewers notice a link that died silently.
    this.broadcastStatus();
  }

  private heartbeat(): void {
    for (const ws of [...this.sourceWss.clients, ...this.viewerWss.clients]) {
      if (this.awaitingPong.has(ws)) {
        this.log('terminating unresponsive websocket peer');
        ws.terminate(); // emits 'close', which updates the sets and status
        continue;
      }
      this.awaitingPong.add(ws);
      ws.ping();
    }
  }

  /** Sends 1001 to every peer, force-terminates stragglers after a short grace period. */
  async close(): Promise<void> {
    clearInterval(this.timer);
    const clients = [...this.sourceWss.clients, ...this.viewerWss.clients];
    for (const ws of clients) ws.close(1001, 'server shutting down');
    let graceTimer: NodeJS.Timeout | undefined;
    const allClosed = Promise.all(
      clients.map((ws) => new Promise<void>((resolve) => (ws.readyState === WebSocket.CLOSED ? resolve() : ws.once('close', () => resolve())))),
    );
    const grace = new Promise<void>((resolve) => {
      graceTimer = setTimeout(resolve, CLOSE_GRACE_MS);
    });
    await Promise.race([allClosed, grace]);
    clearTimeout(graceTimer);
    for (const ws of [...this.sourceWss.clients, ...this.viewerWss.clients]) ws.terminate();
    await Promise.all([this.sourceWss, this.viewerWss].map((wss) => new Promise<void>((resolve) => wss.close(() => resolve()))));
  }
}
