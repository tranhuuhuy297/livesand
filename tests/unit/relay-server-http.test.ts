import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { lanIPv4Addresses } from '../../server/lan-addresses.js';
import { buildPairingInfo } from '../../server/relay-server.js';
import { rawHttp, runCleanups, startTestRelay, TEST_HOST } from './relay-server-test-helpers';

afterEach(runCleanups);

describe('relay server pairing.json', () => {
  it('advertises source/viewer URLs for the bound host with CORS', async () => {
    const server = await startTestRelay();
    const res = await rawHttp(server.port, '/pairing.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(JSON.parse(res.body)).toEqual({
      sourceUrls: [`ws://${TEST_HOST}:${server.port}/ws?role=source`],
      viewerUrls: [`ws://${TEST_HOST}:${server.port}/ws?role=viewer`],
      port: server.port,
    });
    const preflight = await rawHttp(server.port, '/pairing.json', 'OPTIONS');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('*');
  });

  it('uses LAN addresses when bound to all interfaces, else the request host', () => {
    const lan = lanIPv4Addresses();
    const info = buildPairingInfo('0.0.0.0', 8787, 'my-laptop.local:8787');
    const hosts = lan.length > 0 ? lan : ['my-laptop.local'];
    expect(info.port).toBe(8787);
    expect(info.sourceUrls).toEqual(hosts.map((h) => `ws://${h}:8787/ws?role=source`));
    expect(info.viewerUrls).toEqual(hosts.map((h) => `ws://${h}:8787/ws?role=viewer`));
  });
});

describe('relay server static files', () => {
  let root: string;
  let dist: string;
  const indexHtml = '<!doctype html><title>LiveSand</title>';
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'livesand-relay-'));
    dist = path.join(root, 'dist');
    await mkdir(path.join(dist, 'assets'), { recursive: true });
    await mkdir(path.join(root, 'dist-secret'), { recursive: true });
    await writeFile(path.join(dist, 'index.html'), indexHtml);
    await writeFile(path.join(dist, 'assets', 'main-abc123.js'), 'console.log("hi");');
    await writeFile(path.join(dist, 'app.webmanifest'), '{}');
    await writeFile(path.join(root, 'secret.txt'), 'TOP SECRET');
    await writeFile(path.join(root, 'dist-secret', 'x.txt'), 'TOP SECRET');
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('serves files with MIME types and cache headers', async () => {
    const server = await startTestRelay(dist);
    const index = await rawHttp(server.port, '/');
    expect(index).toMatchObject({ status: 200, body: indexHtml });
    expect(index.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(index.headers['cache-control']).toBe('no-cache');
    const js = await rawHttp(server.port, '/assets/main-abc123.js?v=1');
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(js.headers['cache-control']).toContain('immutable');
    const manifest = await rawHttp(server.port, '/app.webmanifest');
    expect(manifest.headers['content-type']).toMatch(/^application\/manifest\+json/);
    const head = await rawHttp(server.port, '/index.html', 'HEAD');
    expect(head).toMatchObject({ status: 200, body: '' });
    expect(head.headers['content-length']).toBe(String(Buffer.byteLength(indexHtml)));
    expect((await rawHttp(server.port, '/', 'POST')).status).toBe(405);
  });

  it('falls back to index.html for client routes but 404s missing assets', async () => {
    const server = await startTestRelay(dist);
    expect(await rawHttp(server.port, '/play/level-2')).toMatchObject({ status: 200, body: indexHtml });
    expect((await rawHttp(server.port, '/assets/missing.js')).status).toBe(404);
  });

  it.each(['/../secret.txt', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt', '/../dist-secret/x.txt'])(
    'blocks path traversal %s',
    async (rawPath) => {
      const server = await startTestRelay(dist);
      const res = await rawHttp(server.port, rawPath);
      expect(res.status).toBe(403);
      expect(res.body).not.toContain('TOP SECRET');
    },
  );

  it('rejects malformed escapes and serves 404 when there is no static dir', async () => {
    const withDist = await startTestRelay(dist);
    expect((await rawHttp(withDist.port, '/%E0%A4%A')).status).toBe(400);
    const bare = await startTestRelay(null);
    expect((await rawHttp(bare.port, '/')).status).toBe(404);
  });
});
