import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { isOriginAllowed, normalizeOrigin } from './relay-origin-policy.js';
import { sendPairingInfo, WS_PATH } from './relay-pairing-endpoint.js';
import type { RelayLimits } from './relay-peer-limits.js';
import { RelayWebSocketHub } from './relay-websocket-hub.js';
import { sendPlainText, serveStaticFile } from './static-file-handler.js';

export { buildPairingInfo, type PairingInfo } from './relay-pairing-endpoint.js';

export interface RelayServerOptions {
  port: number;
  host?: string;
  staticDir?: string | null;
  log?: (msg: string) => void;
  /** Extra browser origins (e.g. a self-hosted copy of the web app) allowed to use the relay. */
  allowedOrigins?: string[];
  /** Interval of the viewer status keepalive; the ping heartbeat runs every third tick. */
  keepaliveMs?: number;
  limits?: RelayLimits;
}

export interface RelayServer {
  port: number;
  close(): Promise<void>;
  stats(): { sources: number; viewers: number; framesRelayed: number };
}

function parseRequestUrl(rawUrl: string | undefined): URL | null {
  try {
    return new URL(rawUrl ?? '/', 'http://relay.invalid');
  } catch {
    return null;
  }
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.on('error', () => {}); // peer may already be gone; nothing useful to report
  socket.once('finish', () => socket.destroy());
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function originSet(origins: string[] | undefined): Set<string> {
  const set = new Set<string>();
  for (const raw of origins ?? []) {
    const origin = normalizeOrigin(raw);
    if (!origin) throw new TypeError(`not a valid origin: "${raw}" (expected e.g. https://example.com)`);
    set.add(origin);
  }
  return set;
}

/** Starts the HTTP + WebSocket relay; resolves once listening (port 0 picks an ephemeral port). */
export function startRelayServer(opts: RelayServerOptions): Promise<RelayServer> {
  const log = opts.log ?? (() => {});
  const staticDir = opts.staticDir ?? null;
  let allowedOrigins: Set<string>;
  try {
    allowedOrigins = originSet(opts.allowedOrigins);
  } catch (err) {
    return Promise.reject(err);
  }
  const hub = new RelayWebSocketHub({ log, keepaliveMs: opts.keepaliveMs, limits: opts.limits });
  let boundPort = opts.port;
  let closePromise: Promise<void> | null = null;

  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = parseRequestUrl(req.url);
    if (!url) return sendPlainText(res, 400, 'Bad request');
    if (url.pathname === '/pairing.json') return sendPairingInfo(req, res, { bindHost: opts.host, port: boundPort, allowedOrigins });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendPlainText(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    }
    if (url.pathname === WS_PATH) return sendPlainText(res, 426, 'Upgrade required: connect with a WebSocket');
    if (!staticDir) return sendPlainText(res, 404, 'LiveSand relay is running, but no web app build is being served.');
    // Use the raw path: WHATWG URL parsing would silently resolve "..", hiding traversal attempts.
    const rawPath = (req.url ?? '/').split('?')[0].split('#')[0];
    await serveStaticFile(req, res, staticDir, rawPath.startsWith('/') ? rawPath : `/${rawPath}`);
  };

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err: unknown) => {
      log(`request ${req.method} ${req.url} failed: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) sendPlainText(res, 500, 'Internal server error');
      else res.destroy();
    });
  });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = parseRequestUrl(req.url);
    if (closePromise) return rejectUpgrade(socket, 503, 'Service Unavailable');
    if (!url || url.pathname !== WS_PATH) return rejectUpgrade(socket, 404, 'Not Found');
    const role = url.searchParams.get('role');
    const peer = req.socket.remoteAddress ?? 'unknown';
    if (!isOriginAllowed(req.headers.origin, req.headers.host, role === 'source' ? 'source' : 'viewer', allowedOrigins)) {
      log(`refused ${role ?? 'role-less'} websocket from ${peer}: origin ${req.headers.origin} is not allowed`);
      return rejectUpgrade(socket, 403, 'Forbidden');
    }
    const refusal = hub.refusal(role, peer);
    if (refusal) {
      log(`refused ${role} websocket from ${peer}: ${refusal}`);
      return rejectUpgrade(socket, 503, 'Service Unavailable');
    }
    hub.handleUpgrade(req, socket, head, role);
  });

  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      const serverClosed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeIdleConnections();
      await hub.close();
      server.closeAllConnections();
      await serverClosed;
      log('relay server closed');
    })();
    return closePromise;
  };

  return new Promise<RelayServer>((resolve, reject) => {
    const onListenError = (err: Error): void => {
      void hub.close();
      reject(err);
    };
    server.once('error', onListenError);
    server.listen(opts.port, opts.host, () => {
      server.off('error', onListenError);
      server.on('error', (err) => log(`relay server error: ${err.message}`));
      boundPort = (server.address() as AddressInfo).port;
      log(`relay listening on ${opts.host ?? 'all interfaces'}:${boundPort}${staticDir ? ` serving ${staticDir}` : ''}`);
      resolve({
        port: boundPort,
        close,
        stats: () => ({ sources: hub.sourceCount, viewers: hub.viewerCount, framesRelayed: hub.framesRelayed }),
      });
    });
  });
}
