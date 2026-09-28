// Fetches the relay's /pairing.json and turns failures into advice the user can act on.
import { relayDisplayHost, relayHttpUrl } from './relay-url-utils';

export interface PairingInfo {
  sourceUrls: string[];
  viewerUrls: string[];
  port: number;
  /** Set by the relay when its URLs cannot work for a phone (e.g. bound to loopback). */
  warning?: string;
}

/** The host answered, but not like a LiveSand relay (static web host, Vite dev server). */
class NotARelayError extends Error {}
class OriginRefusedError extends Error {}

function isPairingInfo(v: unknown): v is PairingInfo {
  const o = v as Partial<PairingInfo> | null;
  return Boolean(o && Array.isArray(o.sourceUrls) && o.sourceUrls.every((u) => typeof u === 'string'));
}

/** /pairing.json URL on the relay's origin; throws TypeError for an unusable relay URL. */
export function pairingInfoUrl(relayUrl: string): string {
  return relayHttpUrl(relayUrl, '/pairing.json');
}

export async function fetchPairingInfo(url: string, signal: AbortSignal): Promise<PairingInfo> {
  const res = await fetch(url, { cache: 'no-store', signal });
  if (res.status === 403) throw new OriginRefusedError('HTTP 403');
  if (!res.ok) throw new NotARelayError(`HTTP ${res.status}`);
  const body: unknown = await res.json(); // an HTML page here throws SyntaxError: also "not a relay"
  if (!isPairingInfo(body) || body.sourceUrls.length === 0) throw new NotARelayError('no source URLs');
  return body;
}

/** What to tell the user after a failed pairing fetch (network errors keep the "is it running?" hint). */
export function describePairingProblem(err: unknown, url: string, pageOrigin = globalThis.location?.origin ?? '<this page>'): string {
  const host = relayDisplayHost(url);
  if (err instanceof NotARelayError || err instanceof SyntaxError) {
    return `${host} answered, but it is not a LiveSand relay. Run “npx livesand” on this computer and open the address it prints, or add ?relay=ws://<computer-ip>:8787 to this page’s address.`;
  }
  if (err instanceof OriginRefusedError) {
    return `The relay at ${host} does not accept this page. Restart it with “npx livesand --allow-origin ${pageOrigin}”.`;
  }
  return `Couldn’t load pairing info from ${url} (${(err as Error).message}). Is the relay running? Retrying…`;
}
