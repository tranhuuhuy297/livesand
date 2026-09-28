// Relay hardening against browser pages and LAN peers: origin checks, per-role message caps, connection caps.
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { MAX_DEPTH_FRAME_BYTES } from '../../server/depth-frame-encoder.js';
import { depthFrame, isStatus, runCleanups, startTestRelay, testClient, wsUrl } from './relay-server-test-helpers';

afterEach(runCleanups);

/** Resolves with the HTTP status of a refused handshake, or 101 when the socket opened. */
function handshakeStatus(url: string, origin?: string): Promise<number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, origin ? { origin } : {});
    ws.on('open', () => {
      ws.terminate();
      resolve(101);
    });
    ws.on('unexpected-response', (req, res) => {
      resolve(res.statusCode ?? 0);
      req.destroy();
    });
    ws.on('error', () => {});
  });
}

describe('relay origin policy', () => {
  it('lets native clients, loopback pages and allowed origins in; refuses other web pages', async () => {
    const server = await startTestRelay(null, { allowedOrigins: ['https://sand.example.org'] });
    const viewer = wsUrl(server.port, 'role=viewer');
    const source = wsUrl(server.port, 'role=source');
    expect(await handshakeStatus(source)).toBe(101); // iPhone app / fake source send no Origin
    expect(await handshakeStatus(viewer, 'http://localhost:5173')).toBe(101);
    expect(await handshakeStatus(viewer, 'https://me.github.io')).toBe(101);
    expect(await handshakeStatus(viewer, 'https://sand.example.org')).toBe(101);
    expect(await handshakeStatus(source, 'https://sand.example.org')).toBe(101);
    expect(await handshakeStatus(viewer, 'https://evil.example')).toBe(403);
    expect(await handshakeStatus(source, 'https://evil.example')).toBe(403);
    expect(await handshakeStatus(source, 'https://me.github.io')).toBe(403); // the hosted demo only ever views
    expect(await handshakeStatus(viewer, 'null')).toBe(403);
    expect(server.stats()).toMatchObject({ sources: 0, viewers: 0 });
  });

  it('refuses a same-origin page reached by a public name (DNS rebinding) but not by a LAN name', async () => {
    const server = await startTestRelay();
    // A page served by the relay itself: Origin and Host name the same host.
    const sameOrigin = (host: string) =>
      new Promise<number>((resolve) => {
        const hostPort = `${host}:${server.port}`;
        const ws = new WebSocket(wsUrl(server.port, 'role=viewer'), { origin: `http://${hostPort}`, headers: { Host: hostPort } });
        ws.on('open', () => (ws.terminate(), resolve(101)));
        ws.on('unexpected-response', (req, res) => (req.destroy(), resolve(res.statusCode ?? 0)));
        ws.on('error', () => {});
      });
    expect(await sameOrigin('attacker.example.com')).toBe(403);
    expect(await sameOrigin('mymac.local')).toBe(101);
    expect(await sameOrigin('mymac')).toBe(101);
    expect(await sameOrigin('192.168.1.20')).toBe(101);
  });
});

describe('relay resource caps', () => {
  it('closes a viewer that sends a large message instead of buffering it', async () => {
    const server = await startTestRelay();
    const v = testClient(server.port, 'role=viewer');
    await v.waitFor(isStatus(0, 1));
    v.ws.send(Buffer.alloc(64 * 1024));
    expect((await v.closed).code).toBe(1009); // message too big
  });

  it('caps source messages at the largest depth frame the browser accepts', async () => {
    const server = await startTestRelay();
    const src = testClient(server.port, 'role=source');
    await src.opened;
    src.ws.send(Buffer.alloc(MAX_DEPTH_FRAME_BYTES + 1));
    expect((await src.closed).code).toBe(1009);
  });

  it('answers 503 once the viewer or per-address limit is reached', async () => {
    const server = await startTestRelay(null, { limits: { maxSources: 4, maxViewers: 2, maxPerAddress: 3 } });
    const viewer = wsUrl(server.port, 'role=viewer');
    const a = testClient(server.port, 'role=viewer');
    const b = testClient(server.port, 'role=viewer');
    await Promise.all([a.waitFor(isStatus(0, 2)), b.opened]);
    expect(await handshakeStatus(viewer)).toBe(503);
    const src = testClient(server.port, 'role=source');
    await src.opened;
    expect(await handshakeStatus(wsUrl(server.port, 'role=source'))).toBe(503); // 3 sockets from 127.0.0.1
    b.ws.close();
    await a.waitFor(isStatus(1, 1));
    expect(await handshakeStatus(viewer)).toBe(101);
    src.ws.send(depthFrame(1));
    expect((await a.waitFor((m) => m.isBinary)).data.equals(depthFrame(1))).toBe(true);
  });
});
