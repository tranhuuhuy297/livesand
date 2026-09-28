// Real-socket helpers for relay server tests: buffered WS inbox with predicate waits, raw HTTP requests.
import { request, type IncomingHttpHeaders, type OutgoingHttpHeaders } from 'node:http';
import { WebSocket, type ClientOptions } from 'ws';
import { DepthFormat, encodeDepthFrame } from '../../server/depth-frame-encoder.js';
import { startRelayServer, type RelayServer, type RelayServerOptions } from '../../server/relay-server.js';

export const TEST_HOST = '127.0.0.1';

export interface InboxMessage {
  data: Buffer;
  isBinary: boolean;
}

export interface StatusMessage {
  type: 'status';
  sources: number;
  viewers: number;
}

export interface TestClient {
  ws: WebSocket;
  inbox: InboxMessage[];
  /** Resolves once the client-side handshake completed (the server may announce the peer earlier). */
  opened: Promise<void>;
  closed: Promise<{ code: number; reason: string }>;
  waitFor(predicate: (m: InboxMessage) => boolean, timeoutMs?: number): Promise<InboxMessage>;
}

/** Parses a status JSON text message, or null for anything else. */
export function asStatus(m: InboxMessage): StatusMessage | null {
  if (m.isBinary) return null;
  try {
    const parsed = JSON.parse(m.data.toString('utf8')) as Partial<StatusMessage>;
    return parsed.type === 'status' ? (parsed as StatusMessage) : null;
  } catch {
    return null;
  }
}

export function isStatus(sources: number, viewers: number): (m: InboxMessage) => boolean {
  return (m) => {
    const s = asStatus(m);
    return s !== null && s.sources === sources && s.viewers === viewers;
  };
}

/** Parses a JSON text message of the given type (e.g. 'ack', 'hello'), or null for anything else. */
export function asControl(m: InboxMessage, type: string): Record<string, unknown> | null {
  if (m.isBinary) return null;
  try {
    const parsed = JSON.parse(m.data.toString('utf8')) as Record<string, unknown>;
    return parsed.type === type ? parsed : null;
  } catch {
    return null;
  }
}

/** A valid LSD1 uint16 frame, as the iPhone app or fake source would send it. */
export function depthFrame(frameIndex = 0, width = 4, height = 3, fill = 1000): Buffer {
  const data = new Uint16Array(width * height).fill(fill);
  return Buffer.from(encodeDepthFrame({ width, height, format: DepthFormat.Uint16Millimeters, timestampMs: 0, frameIndex, data }));
}

/** Opens a WS client whose messages are buffered from the first byte, so nothing sent right after open is lost. */
export function connectClient(url: string, options?: ClientOptions): TestClient {
  const ws = new WebSocket(url, options);
  const inbox: InboxMessage[] = [];
  const waiters: { predicate: (m: InboxMessage) => boolean; resolve: (m: InboxMessage) => void }[] = [];
  ws.on('message', (data, isBinary) => {
    const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
    const msg: InboxMessage = { data: buf, isBinary };
    const idx = waiters.findIndex((w) => w.predicate(msg));
    if (idx >= 0) waiters.splice(idx, 1)[0].resolve(msg);
    else inbox.push(msg);
  });
  ws.on('error', () => {}); // surfaced through `closed` / explicit error tests
  const opened = new Promise<void>((resolve) => ws.once('open', () => resolve()));
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString('utf8') }));
  });
  const waitFor = (predicate: (m: InboxMessage) => boolean, timeoutMs = 3000): Promise<InboxMessage> => {
    const idx = inbox.findIndex(predicate);
    if (idx >= 0) return Promise.resolve(inbox.splice(idx, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms waiting for message`)), timeoutMs);
      waiters.push({ predicate, resolve: (m) => (clearTimeout(timer), resolve(m)) });
    });
  };
  return { ws, inbox, opened, closed, waitFor };
}

export function wsUrl(port: number, query: string, path = '/ws'): string {
  return `ws://${TEST_HOST}:${port}${path}${query ? `?${query}` : ''}`;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RawHttpResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

/** Sends the path verbatim (no client-side URL normalization) so traversal attempts reach the server intact. */
export function rawHttp(port: number, rawPath: string, method = 'GET', headers: OutgoingHttpHeaders = {}): Promise<RawHttpResponse> {
  return new Promise((resolve, reject) => {
    const req = request({ host: TEST_HOST, port, path: rawPath, method, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

const cleanups: (() => unknown)[] = [];

/** Registers teardown work; run it from afterEach via runCleanups (module state is per test file). */
export function trackCleanup(fn: () => unknown): void {
  cleanups.push(fn);
}

export async function runCleanups(): Promise<void> {
  for (const fn of cleanups.splice(0).reverse()) await fn();
}

/** Relay on an ephemeral loopback port, closed automatically after the test. */
export async function startTestRelay(staticDir: string | null = null, opts: Partial<RelayServerOptions> = {}): Promise<RelayServer> {
  const server = await startRelayServer({ port: 0, host: TEST_HOST, staticDir, ...opts });
  trackCleanup(() => server.close());
  return server;
}

/** WS client to the relay, terminated automatically after the test. */
export function testClient(port: number, query: string, options?: ClientOptions): TestClient {
  const c = connectClient(wsUrl(port, query), options);
  trackCleanup(() => c.ws.terminate());
  return c;
}
