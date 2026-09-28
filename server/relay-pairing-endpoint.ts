// GET /pairing.json: the relay URLs the web app shows as the pairing QR, gated by the browser-origin policy.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { advertisedHosts, defaultRouteIPv4, isLoopbackHost, urlHost } from './lan-addresses.js';
import { isOriginAllowed, pairingCorsHeaders } from './relay-origin-policy.js';
import { sendPlainText } from './static-file-handler.js';

export const WS_PATH = '/ws';

export interface PairingInfo {
  sourceUrls: string[];
  viewerUrls: string[];
  port: number;
  /** Set when the advertised URLs cannot work for a phone (loopback-only relay). */
  warning?: string;
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
export function buildPairingInfo(bindHost: string | undefined, port: number, requestHost?: string, preferredIp: string | null = null): PairingInfo {
  let hosts = advertisedHosts(bindHost, preferredIp);
  if (hosts.length === 0) hosts = [hostnameFromHeader(requestHost) ?? '127.0.0.1'];
  const wsUrl = (host: string, role: string) => `ws://${urlHost(host)}:${port}${WS_PATH}?role=${role}`;
  const info: PairingInfo = {
    sourceUrls: hosts.map((h) => wsUrl(h, 'source')),
    viewerUrls: hosts.map((h) => wsUrl(h, 'viewer')),
    port,
  };
  if (hosts.every(isLoopbackHost)) {
    info.warning = `The relay only listens on ${hosts[0]} (this computer), so the iPhone cannot connect. `
      + 'Restart "npx livesand" without --host, or with --host <this computer\'s LAN IP>.';
  }
  return info;
}

/** Serves /pairing.json to same-origin pages, native clients and allowed origins (with CORS/PNA headers). */
export async function sendPairingInfo(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { bindHost: string | undefined; port: number; allowedOrigins: ReadonlySet<string> },
): Promise<void> {
  const origin = req.headers.origin;
  if (!isOriginAllowed(origin, req.headers.host, 'viewer', opts.allowedOrigins)) {
    return sendPlainText(res, 403, 'This page is not allowed to read the relay pairing info', { Vary: 'Origin' });
  }
  const cors = pairingCorsHeaders(origin);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors).end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendPlainText(res, 405, 'Method not allowed', { ...cors, Allow: 'GET, HEAD, OPTIONS' });
  }
  const preferredIp = await defaultRouteIPv4();
  const body = JSON.stringify(buildPairingInfo(opts.bindHost, opts.port, req.headers.host, preferredIp));
  res.writeHead(200, {
    ...cors,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}
