#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { startFakeDepthSource } from './fake-depth-source.js';
import { advertisedHosts, defaultRouteIPv4, isLoopbackHost, isWildcardHost, urlHost } from './lan-addresses.js';
import { normalizeOrigin } from './relay-origin-policy.js';
import { startRelayServer } from './relay-server.js';
import { normalizeSourceUrl } from './relay-source-url.js';

const DEFAULT_PORT = 8787;
const USAGE = `Usage:
  livesand [--port ${DEFAULT_PORT}] [--host <address>] [--allow-origin <https://your.site> ...]
      Serve the LiveSand web app and the depth relay (host defaults to all interfaces).
      --allow-origin lets a self-hosted copy of the web app use this relay (repeatable).
  livesand fake-source [--url ws://localhost:${DEFAULT_PORT}] [--fps 30] [--width 256] [--height 192]
      Stream synthetic LiDAR depth frames to a relay (no iPhone needed).
  livesand --help`;

class CliUsageError extends Error {}

function intOption(name: string, raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new CliUsageError(`--${name} must be an integer between ${min} and ${max}, got "${raw}"`);
  }
  return value;
}

/** Graceful shutdown on Ctrl+C / SIGTERM; a second signal forces exit. */
function installShutdown(close: () => Promise<void>): void {
  let shuttingDown = false;
  const onSignal = (signal: NodeJS.Signals): void => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    console.log(`\n${signal} received, shutting down (press Ctrl+C again to force)...`);
    close().then(
      () => process.exit(0),
      (err: unknown) => {
        console.error('shutdown failed:', err);
        process.exit(1);
      },
    );
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
}

function printBanner(port: number, host: string | undefined, preferredIp: string | null): void {
  const localHost = isWildcardHost(host) ? 'localhost' : urlHost(host as string);
  const lanHosts = advertisedHosts(host, preferredIp).map(urlHost);
  const lines = [
    '',
    `LiveSand relay running on port ${port}`,
    `  This computer:     http://${localHost}:${port}/`,
    `  Projector view:    http://${localHost}:${port}/?mode=projector`,
  ];
  if (lanHosts.length === 0) lines.push('  (no LAN address found: connect this computer to the same Wi-Fi as the iPhone)');
  if (lanHosts.length > 0 && lanHosts.every(isLoopbackHost)) {
    lines.push(
      `  Fake source URL:   ws://${lanHosts[0]}:${port}/ws?role=source`,
      `  warning: bound to loopback (${host}), so the iPhone cannot connect; omit --host or pass this computer's LAN IP.`,
    );
  } else {
    for (const h of lanHosts) lines.push(`  Projector on LAN:  http://${h}:${port}/?mode=projector`);
    for (const h of lanHosts) lines.push(`  iPhone source URL: ws://${h}:${port}/ws?role=source`);
    lines.push('  (or scan the pairing QR code shown in the web app)');
  }
  lines.push('', 'Press Ctrl+C to stop.', '');
  console.log(lines.join('\n'));
}

/** Friendly message for listen errors a user can fix, or null for unexpected ones. */
function listenErrorMessage(code: string | undefined, port: number, host: string | undefined): string | null {
  const where = `${host ?? 'all interfaces'}:${port}`;
  if (code === 'EADDRINUSE') return `port ${port} is already in use; pick another with --port`;
  if (code === 'EADDRNOTAVAIL') return `address ${host} is not available on this machine`;
  if (code === 'EACCES' || code === 'EPERM') {
    return port < 1024 ? `port ${port} needs elevated privileges; use a port >= 1024` : `not allowed to listen on ${where}`;
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `cannot resolve host "${host}"; pass an IP address or omit --host`;
  return null;
}

async function runServer(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: 'string', short: 'p' },
      host: { type: 'string' },
      'allow-origin': { type: 'string', multiple: true },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) return void console.log(USAGE);
  const port = intOption('port', values.port, DEFAULT_PORT, 0, 65535);
  const host = values.host;
  const allowedOrigins = values['allow-origin'] ?? [];
  for (const origin of allowedOrigins) {
    if (!normalizeOrigin(origin)) throw new CliUsageError(`--allow-origin expects an origin like https://example.com, got "${origin}"`);
  }

  // Compiled file lives in dist-server/, the web build in dist/ next to it.
  const staticDir = fileURLToPath(new URL('../dist', import.meta.url));
  const hasBuild = existsSync(path.join(staticDir, 'index.html'));
  if (!hasBuild) {
    console.warn(`warning: web app build not found at ${staticDir} (run "npm run build"); serving the relay only.`);
  }

  const server = await startRelayServer({
    port,
    host,
    staticDir: hasBuild ? staticDir : null,
    allowedOrigins,
    log: (m) => console.log(`[relay] ${m}`),
  }).catch((err: unknown) => {
    const message = listenErrorMessage((err as NodeJS.ErrnoException).code, port, host);
    throw message ? new CliUsageError(message) : err;
  });
  printBanner(server.port, host, await defaultRouteIPv4());
  installShutdown(() => server.close());
}

async function runFakeSource(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      url: { type: 'string', default: `ws://localhost:${DEFAULT_PORT}` },
      fps: { type: 'string' },
      width: { type: 'string' },
      height: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) return void console.log(USAGE);
  try {
    const url = normalizeSourceUrl(values.url);
    const source = startFakeDepthSource({
      url,
      fps: intOption('fps', values.fps, 30, 1, 120),
      width: intOption('width', values.width, 256, 1, 4096),
      height: intOption('height', values.height, 192, 1, 4096),
      log: (m) => console.log(`[fake-source] ${m}`),
      onFatal: (reason) => {
        console.error(`livesand fake-source: ${reason}`);
        process.exit(1);
      },
    });
    console.log(`Streaming fake depth frames to ${url} (Ctrl+C to stop)`);
    installShutdown(async () => source.stop());
  } catch (err) {
    if (err instanceof CliUsageError) throw err;
    throw new CliUsageError(err instanceof Error ? err.message : String(err));
  }
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (command === 'fake-source') return runFakeSource(rest);
  if (command === 'help') return void console.log(USAGE);
  if (command !== undefined && !command.startsWith('-')) throw new CliUsageError(`unknown command "${command}"`);
  return runServer(argv);
}

main(process.argv.slice(2)).catch((err: unknown) => {
  const isParseError = typeof (err as { code?: unknown }).code === 'string' && (err as { code: string }).code.startsWith('ERR_PARSE_ARGS');
  if (err instanceof CliUsageError || isParseError) {
    console.error(`livesand: ${(err as Error).message}\n\n${USAGE}`);
    process.exit(2);
  }
  console.error('livesand: fatal error:', err);
  process.exit(1);
});
