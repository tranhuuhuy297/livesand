// One live depth source at a time, viewer keepalive, and the CLI fake source's URL handling and fatal closes.
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeDepthSource } from '../../server/fake-depth-source.js';
import { CLOSE_REPLACED_BY_NEWER_SOURCE } from '../../server/relay-websocket-hub.js';
import { normalizeSourceUrl } from '../../server/relay-source-url.js';
import {
  asStatus, delay, depthFrame, isStatus, runCleanups, startTestRelay, testClient, trackCleanup, wsUrl,
} from './relay-server-test-helpers';

afterEach(runCleanups);

/** Starts a fake source and resolves with the reason once it gives up for good. */
function fakeSourceFatal(url: string): Promise<string> {
  return new Promise((resolve) => {
    const fake = startFakeDepthSource({ url, fps: 20, width: 8, height: 6, onFatal: resolve });
    trackCleanup(() => fake.stop());
  });
}

describe('relay depth sources', () => {
  it('a newer source replaces the older one (close 4001), so viewers never get interleaved scenes', async () => {
    const server = await startTestRelay();
    const viewer = testClient(server.port, 'role=viewer');
    const first = testClient(server.port, 'role=source');
    await Promise.all([viewer.waitFor(isStatus(1, 1)), first.opened]);
    first.ws.send(depthFrame(1));
    expect((await viewer.waitFor((m) => m.isBinary)).data.equals(depthFrame(1))).toBe(true);
    viewer.inbox.length = 0;

    const second = testClient(server.port, 'role=source');
    const closed = await first.closed;
    expect(closed).toEqual({ code: CLOSE_REPLACED_BY_NEWER_SOURCE, reason: 'replaced by a newer depth source' });
    await second.opened;
    second.ws.send(depthFrame(2, 5, 5));
    expect((await viewer.waitFor((m) => m.isBinary)).data.equals(depthFrame(2, 5, 5))).toBe(true);
    expect(server.stats().sources).toBe(1);
    expect(viewer.inbox.map(asStatus).filter((s) => s && s.sources !== 1)).toEqual([]); // never flickers to 0 or 2
  });

  it('a fake source that gets replaced stops instead of fighting the new source', async () => {
    const server = await startTestRelay();
    const viewer = testClient(server.port, 'role=viewer');
    await viewer.waitFor(isStatus(0, 1));
    const fatal = fakeSourceFatal(wsUrl(server.port, 'role=source'));
    await viewer.waitFor((m) => m.isBinary);
    const phone = testClient(server.port, 'role=source');
    expect(await fatal).toMatch(/took over/);
    await phone.opened;
    await delay(1200); // a reconnecting loser would have replaced the phone by now
    expect(phone.ws.readyState).toBe(phone.ws.OPEN);
    expect(server.stats().sources).toBe(1);
  });

  it('sends viewers a periodic status so browsers can detect a dead link', async () => {
    const server = await startTestRelay(null, { keepaliveMs: 40 });
    const viewer = testClient(server.port, 'role=viewer');
    await viewer.waitFor(isStatus(0, 1));
    for (let i = 0; i < 3; i++) await viewer.waitFor(isStatus(0, 1), 500);
  });
});

describe('fake source URLs', () => {
  it('normalizes what users paste from the banner into the source URL', () => {
    expect(normalizeSourceUrl('192.168.1.5:8787')).toBe('ws://192.168.1.5:8787/ws?role=source');
    expect(normalizeSourceUrl(' ws://127.0.0.1:8787 ')).toBe('ws://127.0.0.1:8787/ws?role=source');
    expect(normalizeSourceUrl('ws://127.0.0.1:8787/ws')).toBe('ws://127.0.0.1:8787/ws?role=source');
    expect(normalizeSourceUrl('http://mymac.local:8787/?mode=projector')).toBe('ws://mymac.local:8787/ws?mode=projector&role=source');
    expect(normalizeSourceUrl('https://relay.example/ws?role=viewer')).toBe('wss://relay.example/ws?role=source');
    expect(() => normalizeSourceUrl('ftp://host/x')).toThrow(TypeError);
    expect(() => normalizeSourceUrl('  ')).toThrow(TypeError);
  });

  it('treats a missing role (1008) or a wrong path (404) as fatal instead of retrying forever', async () => {
    const server = await startTestRelay();
    expect(await fakeSourceFatal(wsUrl(server.port, ''))).toMatch(/refused .*role query param/);
    expect(await fakeSourceFatal(wsUrl(server.port, 'role=source', '/nope'))).toMatch(/HTTP 404/);
  });

  it('refuses frame sizes the browser would reject', () => {
    expect(() => startFakeDepthSource({ url: 'ws://127.0.0.1:1/ws?role=source', width: 2048, height: 1024 })).toThrow(RangeError);
    expect(() => startFakeDepthSource({ url: 'ws://127.0.0.1:1/ws?role=source', width: 5000, height: 1 })).toThrow(RangeError);
  });
});
