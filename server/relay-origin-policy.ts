// Which web pages may talk to the relay. Browsers always send Origin on WebSocket handshakes and CORS fetches, and
// do not apply CORS to WebSockets, so this check is what stops any open tab from injecting or reading depth.
import { isLocalNetworkHost, isLoopbackHost } from './lan-addresses.js';

export type RelayAccess = 'source' | 'viewer';

// The hosted static demo (GitHub Pages) talks to a relay on the visitor's machine, but only ever as a viewer.
const HOSTED_DEMO_SUFFIX = '.github.io';

/** Canonical `scheme://host[:port]` of an origin string, or null when it is not a usable origin (e.g. "null"). */
export function normalizeOrigin(raw: string): string | null {
  try {
    const origin = new URL(raw).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

function sameHostAsRequest(origin: URL, hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  try {
    return new URL(`${origin.protocol}//${hostHeader}`).host === origin.host;
  } catch {
    return false;
  }
}

/**
 * No Origin means a native client (iPhone app, CLI fake source). Browser pages may connect from loopback, from the
 * relay's own origin when reached by a LAN-only name (a public name could be DNS rebinding), from `allowed`, and,
 * for viewers only, from the GitHub Pages demo.
 */
export function isOriginAllowed(
  origin: string | undefined,
  hostHeader: string | undefined,
  access: RelayAccess,
  allowed: ReadonlySet<string> = new Set(),
): boolean {
  if (origin === undefined) return true;
  const canonical = normalizeOrigin(origin);
  if (canonical === null) return false;
  if (allowed.has(canonical)) return true;
  const url = new URL(canonical);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (isLoopbackHost(url.hostname)) return true;
  if (sameHostAsRequest(url, hostHeader) && isLocalNetworkHost(url.hostname)) return true;
  return access === 'viewer' && url.protocol === 'https:' && url.hostname.endsWith(HOSTED_DEMO_SUFFIX);
}

/** CORS + Private Network Access headers for an allowed cross-origin pairing request; same-origin needs none. */
export function pairingCorsHeaders(origin: string | undefined): Record<string, string> {
  const canonical = origin === undefined ? null : normalizeOrigin(origin);
  if (canonical === null) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': canonical,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Private-Network': 'true',
    Vary: 'Origin',
  };
}
