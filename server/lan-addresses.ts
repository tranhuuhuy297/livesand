import { createSocket } from 'node:dgram';
import { isIP } from 'node:net';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

const WILDCARD_HOSTS = new Set(['', '0.0.0.0', '::', '[::]']);
// Host-only adapters (containers, VMs, VPN tunnels, internet sharing) that a phone on the Wi-Fi cannot reach.
const VIRTUAL_INTERFACE =
  /^(docker|br-|veth|virbr|vboxnet|vmnet|vnic|bridge\d|utun|tun|tap|tailscale|zt|wg|lxcbr|lxdbr|podman|cni|flannel|cali|kube|vethernet)|virtualbox|vmware|hyper-v/i;
// Suffixes no one can register publicly, so a browser reaching us by such a name is not a DNS-rebinding page.
const LOCAL_NAME_SUFFIXES = ['.local', '.lan', '.home', '.home.arpa', '.internal', '.localdomain', '.localhost'];

export function isVirtualInterface(name: string): boolean {
  return VIRTUAL_INTERFACE.test(name);
}

function bareHost(host: string): string {
  const h = host.toLowerCase();
  return h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;
}

/** localhost, *.localhost, 127.0.0.0/8 or ::1: reachable from this computer only. */
export function isLoopbackHost(host: string): boolean {
  const h = bareHost(host);
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || (isIP(h) === 4 && h.startsWith('127.'));
}

/** IP literals, single-label names and private-use suffixes like .local: names only the LAN can resolve. */
export function isLocalNetworkHost(host: string): boolean {
  const h = bareHost(host);
  return isIP(h) !== 0 || !h.includes('.') || LOCAL_NAME_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

// Private LAN ranges first so the first advertised URL is the one a phone on the same Wi-Fi can most likely reach.
function reachabilityRank(ip: string): number {
  if (ip.startsWith('192.168.')) return 0;
  if (ip.startsWith('10.')) return 1;
  const second = /^172\.(\d+)\./.exec(ip);
  if (second && Number(second[1]) >= 16 && Number(second[1]) <= 31) return 2;
  if (ip.startsWith('169.254.')) return 4;
  return 3;
}

/**
 * Non-internal IPv4s ranked for the pairing QR: the default-route address first (unless it is a VPN/virtual one),
 * then private ranges; virtual adapters are dropped whenever a physical one exists.
 */
export function rankLanAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>, preferredIp: string | null = null): string[] {
  const found: { ip: string; iface: string; virtual: boolean }[] = [];
  for (const [iface, infos] of Object.entries(interfaces)) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) found.push({ ip: info.address, iface, virtual: isVirtualInterface(iface) });
    }
  }
  const physical = found.filter((f) => !f.virtual);
  const pool = physical.length > 0 ? physical : found;
  const rank = (f: { ip: string; virtual: boolean }) => (f.ip === preferredIp && !f.virtual ? -1 : reachabilityRank(f.ip));
  pool.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.iface < b.iface ? -1 : a.iface > b.iface ? 1 : 0) ||
      (a.ip < b.ip ? -1 : a.ip > b.ip ? 1 : 0),
  );
  return [...new Set(pool.map((f) => f.ip))];
}

/** This machine's LAN IPv4 addresses, most-likely-reachable first, deterministic order. */
export function lanIPv4Addresses(preferredIp: string | null = null): string[] {
  return rankLanAddresses(networkInterfaces(), preferredIp);
}

/** Local IPv4 the OS routes internet traffic through (a UDP connect sends no packets), or null when offline. */
export function defaultRouteIPv4(timeoutMs = 300): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    let done = false;
    const finish = (ip: string | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.close();
      resolve(ip);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.once('error', () => finish(null));
    socket.connect(53, '1.1.1.1', () => {
      try {
        finish(socket.address().address);
      } catch {
        finish(null);
      }
    });
  });
}

/** True when the bind host means "all interfaces" (or was omitted). */
export function isWildcardHost(host: string | undefined): boolean {
  return host === undefined || WILDCARD_HOSTS.has(host);
}

/** Hosts other devices should use: the explicit bind host, or every LAN IPv4 when bound to all interfaces. */
export function advertisedHosts(bindHost: string | undefined, preferredIp: string | null = null): string[] {
  return isWildcardHost(bindHost) ? lanIPv4Addresses(preferredIp) : [bindHost as string];
}

/** Host as it must appear inside a URL (IPv6 literals need brackets). */
export function urlHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}
