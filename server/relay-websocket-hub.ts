import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

// A lagging viewer gets frames dropped instead of an ever-growing queue (latency would explode).
export const MAX_VIEWER_BUFFERED_BYTES = 4 * 1024 * 1024;
export const HEARTBEAT_INTERVAL_MS = 15_000;
// Largest sane depth frame (4096x4096 f32 is ~64 MiB); anything bigger is abuse.
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024 + 64;
const CLOSE_GRACE_MS = 1000;

export type RelayRole = 'source' | 'viewer';

/** Tracks source/viewer sockets, fans binary frames out to viewers, broadcasts status, and reaps dead peers. */
export class RelayWebSocketHub {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  private readonly sources = new Set<WebSocket>();
  private readonly viewers = new Set<WebSocket>();
  private readonly awaitingPong = new WeakSet<WebSocket>();
  private readonly heartbeatTimer: NodeJS.Timeout;
  private readonly log: (msg: string) => void;
  private relayedCount = 0;

  constructor(log: (msg: string) => void) {
    this.log = log;
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref();
  }

  /** Frames from sources that reached at least one viewer. */
  get framesRelayed(): number {
    return this.relayedCount;
  }

  get sourceCount(): number {
    return this.sources.size;
  }

  get viewerCount(): number {
    return this.viewers.size;
  }

  /** Completes the WS handshake; peers without a valid role are closed with 1008 (policy violation). */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, role: string | null): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws, role, req.socket.remoteAddress ?? 'unknown'));
  }

  private accept(ws: WebSocket, role: string | null, peer: string): void {
    ws.on('error', (err) => this.log(`websocket error from ${peer}: ${err.message}`));
    if (role !== 'source' && role !== 'viewer') {
      ws.close(1008, 'role query param must be "source" or "viewer"');
      return;
    }
    const group = role === 'source' ? this.sources : this.viewers;
    group.add(ws);
    ws.on('pong', () => this.awaitingPong.delete(ws));
    // Viewers are receive-only; their messages are deliberately ignored.
    if (role === 'source') ws.on('message', (data, isBinary) => this.relay(data, isBinary));
    ws.on('close', () => {
      if (!group.delete(ws)) return;
      this.log(`${role} disconnected (${peer}); sources=${this.sources.size} viewers=${this.viewers.size}`);
      this.broadcastStatus();
    });
    this.log(`${role} connected (${peer}); sources=${this.sources.size} viewers=${this.viewers.size}`);
    this.broadcastStatus();
  }

  private relay(data: RawData, isBinary: boolean): void {
    if (!isBinary) return; // sources only stream binary depth frames
    const payload = Array.isArray(data) ? Buffer.concat(data) : data;
    let delivered = false;
    for (const viewer of this.viewers) {
      if (viewer.readyState !== WebSocket.OPEN || viewer.bufferedAmount > MAX_VIEWER_BUFFERED_BYTES) continue;
      viewer.send(payload, { binary: true });
      delivered = true;
    }
    if (delivered) this.relayedCount++;
  }

  private broadcastStatus(): void {
    const message = JSON.stringify({ type: 'status', sources: this.sources.size, viewers: this.viewers.size });
    for (const viewer of this.viewers) {
      if (viewer.readyState === WebSocket.OPEN) viewer.send(message);
    }
  }

  private heartbeat(): void {
    for (const ws of [...this.sources, ...this.viewers]) {
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
    clearInterval(this.heartbeatTimer);
    const clients = [...this.wss.clients];
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
    for (const ws of this.wss.clients) ws.terminate();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}
