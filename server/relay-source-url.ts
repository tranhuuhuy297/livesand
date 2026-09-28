// Same rules as normalizeRelayUrl in src/app/physical/relay-url-utils.ts, for URLs typed into the CLI.

/** Turns `host:port`, `http(s)://…` or a URL without /ws or role into `ws(s)://host:port/ws?role=source`. */
export function normalizeSourceUrl(raw: string): string {
  let text = raw.trim();
  if (!text) throw new TypeError('relay URL is empty');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `ws://${text}`;
  const url = new URL(text); // throws TypeError on malformed input
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new TypeError(`relay URL must be ws:// or wss:// (got ${raw})`);
  if (url.pathname === '' || url.pathname === '/') url.pathname = '/ws';
  url.searchParams.set('role', 'source');
  url.hash = '';
  return url.toString();
}
