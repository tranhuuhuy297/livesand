#!/usr/bin/env node
// Bakes the real-world places (src/game/real-places-catalog.ts) into public/places/<id>.bin + manifest.json from the
// AWS Terrain Tiles (Terrarium PNGs). Shares the app's framing/resampling code via Vite's module runner.
// Usage: npm run bake:places [-- --only hoi-an,hue] [--cache /tmp/livesand-terrarium] [--no-cache]
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PNG } from 'pngjs';
import { runnerImport } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = path.join(ROOT, 'public', 'places');
const GRID = { width: 256, height: 192 };
const MAX_TOTAL_BYTES = 1.5 * 1024 * 1024;
const SOURCES_HEADER = 'x-amz-meta-x-imagery-sources';

const { values } = parseArgs({
  options: {
    only: { type: 'string' },
    cache: { type: 'string', default: path.join(tmpdir(), 'livesand-terrarium-cache') },
    'no-cache': { type: 'boolean', default: false },
  },
  allowPositionals: false,
});

async function importSrc(file) {
  const { module } = await runnerImport(path.join(ROOT, 'src', 'game', file), { configFile: false, logLevel: 'silent' });
  return module;
}
const { REAL_PLACES } = await importSrc('real-places-catalog.ts');
const { fetchPlaceMeters } = await importSrc('real-place-tile-fetching.ts');
const { encodeBakedPlace } = await importSrc('real-place-baked-format.ts');
const { attributionForSourceFlags, sourceFlagsFromImageryHeader } = await importSrc('real-place-attribution.ts');
const R = await importSrc('place-terrain-resampling.ts');

/** Fetch with retries and an on-disk tile cache (keeps the imagery-sources header for attribution). */
function makeTileFetch(cacheDir, seenSources) {
  if (cacheDir) mkdirSync(cacheDir, { recursive: true });
  return async (url) => {
    const key = url.replace(/^.*terrarium\//, '').replaceAll('/', '-');
    const pngPath = cacheDir && path.join(cacheDir, key);
    const srcPath = pngPath && `${pngPath}.sources.txt`;
    if (pngPath && existsSync(pngPath) && existsSync(srcPath)) {
      seenSources.push(readFileSync(srcPath, 'utf8'));
      return new Response(readFileSync(pngPath), { status: 200 });
    }
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        const bytes = Buffer.from(await res.arrayBuffer());
        const sources = res.headers.get(SOURCES_HEADER) ?? '';
        seenSources.push(sources);
        if (pngPath) {
          writeFileSync(pngPath, bytes);
          writeFileSync(srcPath, sources);
        }
        return new Response(bytes, { status: 200 });
      } catch (err) {
        lastError = err;
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
    throw lastError;
  };
}

async function decodePng(buf) {
  const png = PNG.sync.read(Buffer.from(buf));
  return { rgba: png.data, width: png.width, height: png.height };
}

function bboxOf(place, zoom) {
  const box = R.placeMercatorBox(place, GRID, zoom);
  const round = (n) => Math.round(n * 1e5) / 1e5;
  return {
    west: round(R.globalPixelXToLon(box.left, zoom)),
    south: round(R.globalPixelYToLat(box.top + box.height, zoom)),
    east: round(R.globalPixelXToLon(box.left + box.width, zoom)),
    north: round(R.globalPixelYToLat(box.top, zoom)),
  };
}

async function bakePlace(place, cacheDir) {
  const seenSources = [];
  const fetchImpl = makeTileFetch(cacheDir, seenSources);
  const { meters, zoom } = await fetchPlaceMeters(place, GRID, fetchImpl, decodePng);
  const sourceFlags = sourceFlagsFromImageryHeader(seenSources.join(','));
  const bytes = encodeBakedPlace({ meters, width: GRID.width, height: GRID.height, sourceFlags, zoom });
  writeFileSync(path.join(OUT_DIR, `${place.id}.bin`), bytes);
  let min = Infinity;
  let max = -Infinity;
  for (const m of meters) {
    min = Math.min(min, m);
    max = Math.max(max, m);
  }
  const datasets = [...new Set(seenSources.join(',').split(',').map((s) => s.trim().split('/')[0]).filter(Boolean))].sort();
  return {
    id: place.id,
    name: place.name,
    file: `${place.id}.bin`,
    width: GRID.width,
    height: GRID.height,
    zoom,
    center: { lat: place.lat, lon: place.lon },
    widthKm: place.widthKm,
    bbox: bboxOf(place, zoom),
    minMeters: Math.round(min * 10) / 10,
    maxMeters: Math.round(max * 10) / 10,
    metersPerCell: Math.round(R.placeMetersPerCell(place, GRID) * 100) / 100,
    sources: datasets,
    attribution: attributionForSourceFlags(sourceFlags),
    bytes: bytes.byteLength,
  };
}

async function main() {
  const only = values.only ? new Set(values.only.split(',').map((s) => s.trim()).filter(Boolean)) : null;
  for (const id of only ?? []) if (!REAL_PLACES.some((p) => p.id === id)) throw new Error(`Unknown place "${id}"`);
  const cacheDir = values['no-cache'] ? null : values.cache;
  mkdirSync(OUT_DIR, { recursive: true });
  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')).places ?? [] : [];
  const entries = new Map(previous.map((e) => [e.id, e]));
  for (const place of REAL_PLACES) {
    if (only && !only.has(place.id)) continue;
    const entry = await bakePlace(place, cacheDir);
    entries.set(place.id, entry);
    console.log(`${place.id}: z${entry.zoom} ${entry.minMeters}..${entry.maxMeters} m, ${entry.sources.join('+')}, ${entry.bytes} B`);
  }
  const places = REAL_PLACES.map((p) => entries.get(p.id)).filter(Boolean);
  const manifest = { version: 1, format: 'LSP1 uint16 quantized meters', grid: GRID, source: 'AWS Terrain Tiles (Terrarium)', places };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const total = readdirSync(OUT_DIR).reduce((n, f) => n + statSync(path.join(OUT_DIR, f)).size, 0);
  console.log(`public/places: ${(total / 1024).toFixed(0)} KiB total`);
  if (total > MAX_TOTAL_BYTES) throw new Error(`public/places is ${total} bytes, over the ${MAX_TOTAL_BYTES} byte budget`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
