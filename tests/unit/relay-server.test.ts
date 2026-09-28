import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { decodeDepthFrame } from '../../src/core/depth-frame-protocol';
import { DEPTH_FRAME_HEADER_BYTES, DEPTH_FRAME_MAGIC } from '../../server/depth-frame-encoder.js';
import { startFakeDepthSource } from '../../server/fake-depth-source.js';
import { delay, isStatus, runCleanups, trackCleanup, startTestRelay, testClient, wsUrl } from './relay-server-test-helpers';

afterEach(runCleanups);

describe('relay server websockets', () => {
  it('relays binary frames from a source to every viewer', async () => {
    const server = await startTestRelay();
    const v1 = testClient(server.port, 'role=viewer');
    const v2 = testClient(server.port, 'role=viewer');
    await v1.waitFor(isStatus(0, 2));
    const src = testClient(server.port, 'role=source');
    await Promise.all([v1.waitFor(isStatus(1, 2)), v2.waitFor(isStatus(1, 2)), src.opened]);

    const frame = Buffer.from([0x4c, 0x53, 0x44, 0x31, 1, 2, 3, 4]);
    src.ws.send(frame);
    const [m1, m2] = await Promise.all([v1.waitFor((m) => m.isBinary), v2.waitFor((m) => m.isBinary)]);
    expect(m1.data.equals(frame)).toBe(true);
    expect(m2.data.equals(frame)).toBe(true);
    expect(server.stats()).toEqual({ sources: 1, viewers: 2, framesRelayed: 1 });
  });

  it('sends status to viewers right after connect and on every connect/disconnect', async () => {
    const server = await startTestRelay();
    const v1 = testClient(server.port, 'role=viewer');
    await v1.waitFor(isStatus(0, 1));
    const src = testClient(server.port, 'role=source');
    await v1.waitFor(isStatus(1, 1));
    const v2 = testClient(server.port, 'role=viewer');
    await Promise.all([v1.waitFor(isStatus(1, 2)), v2.waitFor(isStatus(1, 2))]);
    src.ws.close();
    await Promise.all([v1.waitFor(isStatus(0, 2)), v2.waitFor(isStatus(0, 2))]);
    v2.ws.close();
    await v1.waitFor(isStatus(0, 1));
    expect(server.stats()).toMatchObject({ sources: 0, viewers: 1 });
    expect(src.inbox).toEqual([]); // sources never get status or frames
  });

  it('ignores source text messages and anything viewers send', async () => {
    const server = await startTestRelay();
    const v1 = testClient(server.port, 'role=viewer');
    const v2 = testClient(server.port, 'role=viewer');
    const src = testClient(server.port, 'role=source');
    await Promise.all([v1.waitFor(isStatus(1, 2)), v2.waitFor(isStatus(1, 2)), src.opened]);
    src.ws.send('not a frame');
    v1.ws.send(Buffer.from([9, 9, 9]));
    src.ws.send(Buffer.from([7]));
    const got = await v2.waitFor((m) => m.isBinary);
    expect([...got.data]).toEqual([7]);
    await delay(100);
    expect(v2.inbox.filter((m) => m.isBinary || m.data.toString() === 'not a frame')).toEqual([]);
    expect(src.inbox).toEqual([]);
    expect(server.stats().framesRelayed).toBe(1);
  });

  it.each(['', 'role=bogus', 'role='])('closes connections with query "%s" using code 1008', async (query) => {
    const server = await startTestRelay();
    const c = testClient(server.port, query);
    const { code } = await c.closed;
    expect(code).toBe(1008);
    expect(server.stats()).toEqual({ sources: 0, viewers: 0, framesRelayed: 0 });
  });

  it('rejects websocket upgrades outside /ws', async () => {
    const server = await startTestRelay();
    const ws = new WebSocket(wsUrl(server.port, 'role=viewer', '/nope'));
    const err = await new Promise<Error>((resolve) => ws.on('error', resolve));
    expect(err.message).toContain('404');
  });

  it('drops frames for a viewer whose send buffer exceeds 4 MiB while fast viewers get everything', async () => {
    const server = await startTestRelay();
    const slow = testClient(server.port, 'role=viewer');
    const fast = testClient(server.port, 'role=viewer');
    const src = testClient(server.port, 'role=source');
    await Promise.all([slow.waitFor(isStatus(1, 2)), fast.waitFor(isStatus(1, 2)), src.opened, slow.opened]);
    slow.ws.pause(); // stop reading: TCP backpressure builds up on the relay side

    const frameCount = 64;
    const frame = Buffer.alloc(1024 * 1024, 1);
    // Paced by the fast viewer so only the paused viewer ever builds a backlog.
    for (let i = 0; i < frameCount; i++) {
      src.ws.send(frame);
      await fast.waitFor((m) => m.isBinary);
    }

    slow.ws.resume();
    let seen = -1;
    while (seen !== slow.inbox.length) {
      seen = slow.inbox.length;
      await delay(300);
    }
    const slowFrames = slow.inbox.filter((m) => m.isBinary).length;
    expect(slowFrames).toBeGreaterThan(0);
    expect(slowFrames).toBeLessThan(frameCount);
    expect(server.stats().framesRelayed).toBe(frameCount);
  }, 20_000);

  it('close() says goodbye to connected peers with code 1001', async () => {
    const server = await startTestRelay();
    const v = testClient(server.port, 'role=viewer');
    await v.waitFor(isStatus(0, 1));
    await server.close();
    expect((await v.closed).code).toBe(1001);
  });
});

describe('fake depth source', () => {
  it('streams LSD1 uint16 frames of the requested size that viewers receive', async () => {
    const server = await startTestRelay();
    const viewer = testClient(server.port, 'role=viewer');
    await viewer.waitFor(isStatus(0, 1));
    const fake = startFakeDepthSource({ url: wsUrl(server.port, 'role=source'), fps: 30, width: 64, height: 48 });
    trackCleanup(() => fake.stop());

    const first = await viewer.waitFor((m) => m.isBinary);
    const second = await viewer.waitFor((m) => m.isBinary);
    expect(first.data.byteLength).toBe(DEPTH_FRAME_HEADER_BYTES + 64 * 48 * 2);
    const view = new DataView(first.data.buffer, first.data.byteOffset, first.data.byteLength);
    expect(view.getUint32(0, true)).toBe(DEPTH_FRAME_MAGIC);
    expect(view.getUint16(6, true)).toBe(2);
    const a = decodeDepthFrame(new Uint8Array(first.data));
    const b = decodeDepthFrame(new Uint8Array(second.data));
    expect([a.width, a.height]).toEqual([64, 48]);
    expect(b.frameIndex).toBe(a.frameIndex + 1);
    expect(Math.min(...a.depthMeters)).toBeCloseTo(0.7, 2); // hand blob
    expect(Math.max(...a.depthMeters)).toBeLessThanOrEqual(1.003); // flat sand + sensor noise

    fake.stop();
    await viewer.waitFor(isStatus(0, 1));
  });

  it('rejects non-websocket URLs up front', () => {
    expect(() => startFakeDepthSource({ url: 'http://localhost:1/ws' })).toThrow(TypeError);
    expect(() => startFakeDepthSource({ url: 'not a url' })).toThrow();
  });
});
