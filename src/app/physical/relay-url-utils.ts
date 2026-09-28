// Relay URL helpers: default viewer URL for the current page, ?relay= normalization, HTTP pairing endpoint.

export const DEFAULT_RELAY_PORT = 8787;
const FALLBACK_VIEWER_URL = `ws://localhost:${DEFAULT_RELAY_PORT}/ws?role=viewer`;

export type RelayRole = 'viewer' | 'source';

/** Vite dev server (5173 / 51xx) and vite preview (4173) never host the relay. */
function isDevServerPort(port: string): boolean {
  const n = Number(port);
  return n === 4173 || (n >= 5100 && n <= 5199);
}

/**
 * Accepts `ws(s)://host:port[/ws]`, `http(s)://host:port` or bare `host:port` and returns the relay WS URL
 * for `role`. Throws TypeError when it cannot be a relay URL.
 */
export function normalizeRelayUrl(raw: string, role: RelayRole = 'viewer'): string {
  let text = raw.trim();
  if (!text) throw new TypeError('Relay URL is empty');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `ws://${text}`;
  const url = new URL(text);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new TypeError(`Relay URL must be ws:// or wss:// (got ${raw})`);
  if (url.pathname === '' || url.pathname === '/') url.pathname = '/ws';
  url.searchParams.set('role', role);
  url.hash = '';
  return url.toString();
}

/** ws(s)://<page host>/ws?role=viewer when this page is served by the relay, else the local relay default; ?relay= wins. */
export function defaultRelayUrl(loc: Location): string {
  const override = new URLSearchParams(loc.search).get('relay');
  if (override) {
    try {
      return normalizeRelayUrl(override);
    } catch (err) {
      console.warn(`Ignoring invalid ?relay= value: ${(err as Error).message}`);
    }
  }
  const httpPage = loc.protocol === 'http:' || loc.protocol === 'https:';
  // GitHub Pages hosts the static demo only; the relay then runs on the visitor's own machine.
  const servedByRelay = httpPage && !isDevServerPort(loc.port) && !/(^|\.)github\.io$/i.test(loc.hostname);
  if (servedByRelay) return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws?role=viewer`;
  return FALLBACK_VIEWER_URL;
}

/** HTTP(S) URL on the relay's origin, e.g. the /pairing.json endpoint. */
export function relayHttpUrl(relayUrl: string, path: string): string {
  const url = new URL(relayUrl);
  const scheme = url.protocol === 'wss:' ? 'https:' : 'http:';
  return new URL(path, `${scheme}//${url.host}`).toString();
}

/** Human-readable relay address for status text. */
export function relayDisplayHost(relayUrl: string): string {
  try {
    return new URL(relayUrl).host;
  } catch {
    return relayUrl;
  }
}
