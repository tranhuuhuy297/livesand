import { networkInterfaces } from 'node:os';

const WILDCARD_HOSTS = new Set(['', '0.0.0.0', '::', '[::]']);

// Private LAN ranges first so the first advertised URL is the one a phone on the same Wi-Fi can most likely reach.
function reachabilityRank(ip: string): number {
  if (ip.startsWith('192.168.')) return 0;
  if (ip.startsWith('10.')) return 1;
  const second = /^172\.(\d+)\./.exec(ip);
  if (second && Number(second[1]) >= 16 && Number(second[1]) <= 31) return 2;
  if (ip.startsWith('169.254.')) return 4;
  return 3;
}

/** Non-internal IPv4 addresses of this machine, most-likely-reachable first, deterministic order. */
export function lanIPv4Addresses(): string[] {
  const found: { ip: string; iface: string }[] = [];
  for (const [iface, infos] of Object.entries(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) found.push({ ip: info.address, iface });
    }
  }
  found.sort(
    (a, b) =>
      reachabilityRank(a.ip) - reachabilityRank(b.ip) ||
      (a.iface < b.iface ? -1 : a.iface > b.iface ? 1 : 0) ||
      (a.ip < b.ip ? -1 : a.ip > b.ip ? 1 : 0),
  );
  return [...new Set(found.map((f) => f.ip))];
}

/** True when the bind host means "all interfaces" (or was omitted). */
export function isWildcardHost(host: string | undefined): boolean {
  return host === undefined || WILDCARD_HOSTS.has(host);
}

/** Hosts other devices should use: the explicit bind host, or every LAN IPv4 when bound to all interfaces. */
export function advertisedHosts(bindHost: string | undefined): string[] {
  return isWildcardHost(bindHost) ? lanIPv4Addresses() : [bindHost as string];
}

/** Host as it must appear inside a URL (IPv6 literals need brackets). */
export function urlHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}
