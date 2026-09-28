// Pure host/interface classification behind the pairing QR and the relay's browser-origin policy.
import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { defaultRouteIPv4, isLocalNetworkHost, isLoopbackHost, isVirtualInterface, rankLanAddresses } from '../../server/lan-addresses.js';
import { isOriginAllowed, normalizeOrigin } from '../../server/relay-origin-policy.js';

const v4 = (address: string): NetworkInterfaceInfo =>
  ({ address, family: 'IPv4', internal: false, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: `${address}/24` });
const lo: NetworkInterfaceInfo = { ...v4('127.0.0.1'), internal: true };

describe('rankLanAddresses', () => {
  it.each([
    ['Wi-Fi + libvirt', { wlan0: [v4('10.0.0.23')], virbr0: [v4('192.168.122.1')] }, ['10.0.0.23']],
    ['macOS en0 + VM bridge', { en0: [v4('172.20.4.17')], bridge100: [v4('192.168.64.1')] }, ['172.20.4.17']],
    ['Wi-Fi + docker', { wlan0: [v4('172.20.4.17')], docker0: [v4('172.17.0.1')], 'br-1a2b': [v4('172.23.0.1')] }, ['172.20.4.17']],
    ['Windows + VirtualBox', { 'Wi-Fi': [v4('10.1.1.5')], 'VirtualBox Host-Only Network': [v4('192.168.56.1')] }, ['10.1.1.5']],
    ['VPN tunnel', { en0: [v4('192.168.1.9')], utun3: [v4('10.8.0.2')], tailscale0: [v4('100.64.0.7')] }, ['192.168.1.9']],
    ['only a container bridge', { docker0: [v4('172.17.0.1')], lo: [lo] }, ['172.17.0.1']],
    ['two physical NICs', { eth0: [v4('10.0.0.4')], wlan0: [v4('192.168.1.9')] }, ['192.168.1.9', '10.0.0.4']],
  ])('%s', (_name, ifaces, expected) => {
    expect(rankLanAddresses(ifaces)).toEqual(expected);
  });

  it('puts the default-route address first unless it belongs to a virtual/VPN adapter', () => {
    const ifaces = { eth0: [v4('192.168.1.9')], wlan0: [v4('10.0.0.23')], utun3: [v4('10.8.0.2')] };
    expect(rankLanAddresses(ifaces, '10.0.0.23')).toEqual(['10.0.0.23', '192.168.1.9']);
    expect(rankLanAddresses(ifaces, '10.8.0.2')).toEqual(['192.168.1.9', '10.0.0.23']);
  });

  it('classifies interfaces and hosts', () => {
    const matching = (names: string[], test: (n: string) => boolean) => names.filter(test);
    const virtual = ['docker0', 'veth12ab', 'vmnet8', 'vEthernet (WSL)', 'wg0', 'zt3jnk'];
    expect(matching(virtual, isVirtualInterface)).toEqual(virtual);
    expect(matching(['en0', 'wlan0', 'wlp2s0', 'eth0', 'enp3s0', 'br0', 'Wi-Fi', 'Ethernet'], isVirtualInterface)).toEqual([]);
    const loopback = ['localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]', 'app.localhost'];
    expect(matching(loopback, isLoopbackHost)).toEqual(loopback);
    expect(matching(['192.168.1.2', 'localhost.example.com', '128.0.0.1'], isLoopbackHost)).toEqual([]);
    const lan = ['192.168.1.2', '[fe80::1]', 'mymac', 'mymac.local', 'nas.lan', 'box.home.arpa'];
    expect(matching(lan, isLocalNetworkHost)).toEqual(lan);
    expect(matching(['evil.example.com', 'me.github.io'], isLocalNetworkHost)).toEqual([]);
  });

  it('finds the default-route address quickly (or null when offline)', async () => {
    const ip = await defaultRouteIPv4();
    expect(ip === null || /^\d+\.\d+\.\d+\.\d+$/.test(ip)).toBe(true);
  });
});

describe('isOriginAllowed', () => {
  const allowed = new Set(['https://sand.example.org']);
  it.each([
    [undefined, '192.168.1.5:8787', 'source', true],
    ['http://localhost:5173', '127.0.0.1:8787', 'source', true],
    ['http://192.168.1.5:8787', '192.168.1.5:8787', 'source', true],
    ['http://mymac.local:8787', 'mymac.local:8787', 'viewer', true],
    ['http://rebind.attacker.com:8787', 'rebind.attacker.com:8787', 'viewer', false],
    ['http://192.168.1.6:8787', '192.168.1.5:8787', 'viewer', false],
    ['https://me.github.io', '127.0.0.1:8787', 'viewer', true],
    ['https://me.github.io', '127.0.0.1:8787', 'source', false],
    ['http://me.github.io', '127.0.0.1:8787', 'viewer', false],
    ['https://sand.example.org', 'relay:8787', 'source', true],
    ['https://evil.example', '192.168.1.5:8787', 'viewer', false],
    ['null', '192.168.1.5:8787', 'viewer', false],
    ['chrome-extension://abc', '192.168.1.5:8787', 'viewer', false],
  ] as const)('origin %s via %s as %s -> %s', (origin, host, access, expected) => {
    expect(isOriginAllowed(origin, host, access, allowed)).toBe(expected);
  });

  it('normalizes origins for the allowlist', () => {
    expect(normalizeOrigin('HTTPS://Sand.Example.org/path?q')).toBe('https://sand.example.org');
    expect(normalizeOrigin('http://x.test:80')).toBe('http://x.test');
    expect(normalizeOrigin('not an origin')).toBeNull();
    expect(normalizeOrigin('null')).toBeNull();
  });
});
