import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { advertisedHosts, urlHost } from './lan-addresses.js';
import { RelayWebSocketHub } from './relay-websocket-hub.js';
import { sendPlainText, serveStaticFile } from './static-file-handler.js';

export interface RelayServerOptions {
  port: number;
  host?: string;
  staticDir?: string | null;
  log?: (msg: string) => void;
}

export interface RelayServer {
  port: number;
  close(): Promise<void>;
  stats(): { sources: number; viewers: number; framesRelayed: number };
}

export interface PairingInfo {
  sourceUrls: string[];
  viewerUrls: string[];
  port: number;
}

const WS_PATH = '/ws';
const PAIRING_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  // Chrome's Private Network Access preflight: lets a public origin (e.g. GitHub Pages) read LAN pairing info.
  'Access-Control-Allow-Private-Network': 'true',
};

function parseRequestUrl(rawUrl: string | undefined): URL | null {
  try {
    return new URL(rawUrl ?? '/', 'http://relay.invalid');
  } catch {
    return null;
  }
}

function hostnameFromHeader(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}/`).hostname || null;
  } catch {
    return null;
  }
}

/** Relay URLs for other devices; falls back to the host the requester used when no LAN address exists. */
export function buildPairingInfo(bindHost: string | undefined, port: number, requestHost?: string): PairingInfo {
  let hosts = advertisedHosts(bindHost);
  if (hosts.length === 0) hosts = [hostnameFromHeader(requestHost) ?? '127.0.0.1'];
  const wsUrl = (host: string, role: string) => `ws://${urlHost(host)}:${port}${WS_PATH}?role=${role}`;
  return {
    sourceUrls: hosts.map((h) => wsUrl(h, 'source')),
    viewerUrls: hosts.map((h) => wsUrl(h, 'viewer')),
    port,
  };
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.on('error', () => {}); // peer may already be gone; nothing useful to report
  socket.once('finish', () => socket.destroy());
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/** Starts the HTTP + WebSocket relay; resolves once listening (port 0 picks an ephemeral port). */
export function startRelayServer(opts: RelayServerOptions): Promise<RelayServer> {
  const log = opts.log ?? (() => {});
  const staticDir = opts.staticDir ?? null;
  const hub = new RelayWebSocketHub(log);
  let boundPort = opts.port;
  let closePromise: Promise<void> | null = null;

  const sendPairing = (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, PAIRING_CORS_HEADERS).end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendPlainText(res, 405, 'Method not allowed', { ...PAIRING_CORS_HEADERS, Allow: 'GET, HEAD, OPTIONS' });
      return;
    }
    const body = JSON.stringify(buildPairingInfo(opts.host, boundPort, req.headers.host));
    res.writeHead(200, {
      ...PAIRING_CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    });
    res.end(body);
  };

  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = parseRequestUrl(req.url);
    if (!url) return sendPlainText(res, 400, 'Bad request');
    if (url.pathname === '/pairing.json') return sendPairing(req, res);
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
    hub.handleUpgrade(req, socket, head, url.searchParams.get('role'));
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
