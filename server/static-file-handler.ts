import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

export const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export type StaticPathResolution = { ok: true; filePath: string } | { ok: false; status: 400 | 403 };

interface FoundFile {
  filePath: string;
  size: number;
  mtime: Date;
}

/** Maps a URL pathname to a file path strictly inside staticDir; rejects malformed and traversal attempts. */
export function resolveStaticPath(staticDir: string, urlPathname: string): StaticPathResolution {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch {
    return { ok: false, status: 400 };
  }
  if (decoded.includes('\0')) return { ok: false, status: 400 };
  // Windows drive letters / alternate data streams must never reach the filesystem.
  if (process.platform === 'win32' && decoded.includes(':')) return { ok: false, status: 403 };
  const root = path.resolve(staticDir);
  const filePath = path.join(root, decoded);
  const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (filePath !== root && !filePath.startsWith(rootPrefix)) return { ok: false, status: 403 };
  return { ok: true, filePath };
}

async function findFile(filePath: string): Promise<FoundFile | null> {
  for (const candidate of [filePath, path.join(filePath, 'index.html')]) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return { filePath: candidate, size: info.size, mtime: info.mtime };
      if (!info.isDirectory()) return null;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENAMETOOLONG') return null;
      throw err;
    }
  }
  return null;
}

// Client-side routes have no extension; a missing /x.js must 404 instead of returning HTML as JavaScript.
function wantsSpaFallback(urlPathname: string): boolean {
  const ext = path.posix.extname(urlPathname);
  return ext === '' || ext === '.html';
}

function cacheControlFor(root: string, filePath: string): string {
  if (filePath.endsWith('.html')) return 'no-cache';
  // Vite emits content-hashed names under assets/, so they never change in place.
  if (path.relative(root, filePath).startsWith(`assets${path.sep}`)) return 'public, max-age=31536000, immutable';
  return 'no-cache';
}

/** Sends a short plain-text response (errors, notices). */
export function sendPlainText(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}): void {
  const body = `${message}\n`;
  res.writeHead(status, {
    ...headers,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/** Serves a GET/HEAD request from staticDir with SPA fallback to index.html. */
export async function serveStaticFile(
  req: IncomingMessage,
  res: ServerResponse,
  staticDir: string,
  urlPathname: string,
): Promise<void> {
  const resolved = resolveStaticPath(staticDir, urlPathname);
  if (!resolved.ok) {
    sendPlainText(res, resolved.status, resolved.status === 403 ? 'Forbidden' : 'Bad request');
    return;
  }
  const root = path.resolve(staticDir);
  let file = await findFile(resolved.filePath);
  if (!file && wantsSpaFallback(urlPathname)) file = await findFile(path.join(root, 'index.html'));
  if (!file) {
    sendPlainText(res, 404, 'Not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': MIME_TYPES[path.extname(file.filePath).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': file.size,
    'Cache-Control': cacheControlFor(root, file.filePath),
    'Last-Modified': file.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  try {
    await pipeline(createReadStream(file.filePath), res);
  } catch {
    res.destroy(); // client went away or the file vanished mid-stream; headers are already sent
  }
}
