// Viewer relay link: silent-link watchdog, default relay URL for the page, pairing error advice.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DepthStreamClient } from '../../src/app/physical/depth-stream-client';
import { RELAY_SILENCE_TIMEOUT_MS } from '../../src/app/physical/relay-silence-watchdog';
import { describePairingProblem } from '../../src/app/physical/relay-pairing-info-fetch';
import { defaultRelayUrl, isServedByRelay } from '../../src/app/physical/relay-url-utils';

/** Minimal browser WebSocket stand-in the test drives by hand. */
class FakeSocket {
  static all: FakeSocket[] = [];
  binaryType = 'blob';
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  closedWith: number | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  close(code = 1000): void {
    this.closedWith = code;
  }
  status(sources: number): void {
    this.onmessage?.({ data: JSON.stringify({ type: 'status', sources, viewers: 1 }) });
  }
}

describe('DepthStreamClient silence watchdog', () => {
  beforeEach(() => {
    FakeSocket.all = [];
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps a talking link open, and redials one that went silent while the browser still calls it open', () => {
    const client = new DepthStreamClient({ url: 'ws://relay.test:8787/ws?role=viewer' });
    client.start();
    const first = FakeSocket.all[0];
    first.onopen?.();
    first.status(1);
    expect(client.state).toBe('open');

    for (let t = 0; t < 4; t++) {
      vi.advanceTimersByTime(RELAY_SILENCE_TIMEOUT_MS / 2); // keepalives keep arriving
      first.status(1);
    }
    expect(client.state).toBe('open');
    expect(first.closedWith).toBeNull();

    let silentMs = 0;
    while (client.state === 'open' && silentMs < RELAY_SILENCE_TIMEOUT_MS * 2) {
      vi.advanceTimersByTime(100);
      silentMs += 100;
    }
    expect(silentMs).toBeGreaterThanOrEqual(RELAY_SILENCE_TIMEOUT_MS);
    expect(silentMs).toBeLessThan(RELAY_SILENCE_TIMEOUT_MS * 1.5);
    expect(client.state).toBe('closed');
    expect(client.sources).toBe(0);
    expect(client.lastError).toMatch(/went silent/);
    expect(client.retryInMs).not.toBeNull();
    expect(first.closedWith).toBe(4000);
    expect(first.onmessage).toBeNull(); // late events from the dead socket are ignored

    vi.advanceTimersByTime(1000);
    expect(FakeSocket.all).toHaveLength(2);
    client.stop();
  });

  it('does not run the watchdog before the socket opens or after stop()', () => {
    const client = new DepthStreamClient({ url: 'ws://relay.test:8787/ws?role=viewer' });
    client.start();
    vi.advanceTimersByTime(RELAY_SILENCE_TIMEOUT_MS * 2);
    expect(FakeSocket.all).toHaveLength(1);
    FakeSocket.all[0].onopen?.();
    client.stop();
    vi.advanceTimersByTime(RELAY_SILENCE_TIMEOUT_MS * 2);
    expect(FakeSocket.all).toHaveLength(1);
  });
});

describe('default relay URL for the page', () => {
  const loc = (href: string) => {
    const u = new URL(href);
    return { protocol: u.protocol, hostname: u.hostname, port: u.port, host: u.host, search: u.search } as Location;
  };

  it('uses the page origin only when the relay serves the page', () => {
    expect(defaultRelayUrl(loc('http://192.168.1.5:8787/?mode=projector'), false)).toBe('ws://192.168.1.5:8787/ws?role=viewer');
    expect(defaultRelayUrl(loc('http://localhost:9000/'), false)).toBe('ws://localhost:9000/ws?role=viewer');
    expect(defaultRelayUrl(loc('http://mymac.local/'), false)).toBe('ws://mymac.local/ws?role=viewer');
    for (const href of ['https://me.github.io/livesand/', 'https://livesand.netlify.app/', 'https://sandbox.example.com/', 'http://localhost:4173/']) {
      expect(defaultRelayUrl(loc(href), false)).toBe('ws://localhost:8787/ws?role=viewer');
    }
    expect(isServedByRelay(loc('http://localhost:5287/'), true)).toBe(false); // any Vite dev port
    expect(defaultRelayUrl(loc('https://me.github.io/?relay=10.0.0.2:8787'), false)).toBe('ws://10.0.0.2:8787/ws?role=viewer');
  });

  it('explains pairing failures in terms of what to do', () => {
    const url = 'http://localhost:5287/pairing.json';
    expect(describePairingProblem(new SyntaxError("Unexpected token '<'"), url)).toMatch(/not a LiveSand relay/);
    expect(describePairingProblem(new SyntaxError('x'), url)).not.toMatch(/Unexpected token/);
    expect(describePairingProblem(new TypeError('Failed to fetch'), url)).toMatch(/Is the relay running\?/);
  });
});
