import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_GRID } from '../../src/core/types';
import { layoutToCell } from '../../src/game/terrain-generators';
import { REAL_PLACES, bakedPlaceUrl, findRealPlace, loadBakedPlace, placeUV } from '../../src/game/real-places';

const PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url));
const PLACES_DIR = `${PUBLIC_DIR}places/`;
const COASTAL = new Set(['ha-long-bay', 'hoi-an', 'hue']);

/** Serves page-relative URLs from public/ like the dev server / GitHub Pages would. */
const diskFetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (!url.startsWith('./')) return new Response('absolute URLs are not served', { status: 400 });
  try {
    return new Response(readFileSync(PUBLIC_DIR + url.slice(2)));
  } catch {
    return new Response('not found', { status: 404 });
  }
}) as unknown as typeof fetch;

function argMax(a: Float32Array): number {
  let best = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[best]) best = i;
  return best;
}

describe('baked real places', () => {
  it('fetches ./places/<id>.bin relative to the page', () => {
    expect(bakedPlaceUrl('hoi-an')).toBe('./places/hoi-an.bin');
  });

  it.each(REAL_PLACES.map((p) => p.id))('loads %s from public/places', async (id) => {
    const place = findRealPlace(id)!;
    const t = await loadBakedPlace(id, DEFAULT_GRID, diskFetch);
    expect(t.heights).toHaveLength(DEFAULT_GRID.width * DEFAULT_GRID.height);
    let min = Infinity;
    let max = -Infinity;
    for (const h of t.heights) {
      expect(Number.isFinite(h)).toBe(true);
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
    expect(t.minHeight).toBe(min);
    expect(t.maxHeight).toBe(max);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(32.01);
    // Real relief, not a flat plate (deltas are low on purpose: DEM canopy noise is smoothed away there).
    expect(max - Math.max(t.seaLevel, min)).toBeGreaterThan(COASTAL.has(id) ? 2 : 5);
    expect(t.metersPerCell).toBeCloseTo((place.widthKm * 1000) / (DEFAULT_GRID.width - 1), 6);
    expect(t.metersPerUnitVertical).toBeGreaterThan(0);
    expect(t.attribution).toMatch(/Mapzen/);
    expect(t.attribution).toMatch(/U\.S\. Geological Survey/);
    const edges = Object.values(t.openEdges);
    if (COASTAL.has(id)) {
      expect(t.seaLevel).toBe(2);
      expect(edges.some(Boolean)).toBe(true);
      expect(t.heights.some((h) => h < t.seaLevel)).toBe(true);
    } else {
      expect(t.seaLevel).toBe(0);
      // Inland rivers leave the frame instead of pooling against closed walls.
      expect(edges.every(Boolean)).toBe(true);
      expect(min).toBeCloseTo(2, 5);
    }
  });

  it('credits the datasets that actually built each place', async () => {
    expect((await loadBakedPlace('yosemite', DEFAULT_GRID, diskFetch)).attribution).toMatch(/3DEP/);
    expect((await loadBakedPlace('mount-fuji', DEFAULT_GRID, diskFetch)).attribution).toMatch(/ETOPO1/);
    expect((await loadBakedPlace('hoi-an', DEFAULT_GRID, diskFetch)).attribution).toMatch(/SRTM/);
  });

  it.each([
    ['mount-fuji', 35.3606, 138.7274],
    ['fansipan', 22.3033, 103.775],
  ])('puts the %s summit where placeUV says it is', async (id, lat, lon) => {
    const t = await loadBakedPlace(id, DEFAULT_GRID, diskFetch);
    const { u, v } = placeUV(findRealPlace(id)!, DEFAULT_GRID, lat, lon);
    const i = argMax(t.heights);
    const dx = (i % DEFAULT_GRID.width) - layoutToCell(u, DEFAULT_GRID.width);
    const dy = Math.floor(i / DEFAULT_GRID.width) - layoutToCell(v, DEFAULT_GRID.height);
    expect(Math.hypot(dx, dy)).toBeLessThan(4);
  });

  it('resamples onto other grid sizes', async () => {
    const grid = { width: 128, height: 96 };
    const t = await loadBakedPlace('yosemite', grid, diskFetch);
    expect(t.heights).toHaveLength(128 * 96);
    expect(t.metersPerCell).toBeCloseTo(15000 / 127, 6);
    expect(t.maxHeight).toBeGreaterThan(25);
  });

  it('reports unknown places, HTTP failures, network errors and corrupt files', async () => {
    const calls = vi.fn(diskFetch);
    await expect(loadBakedPlace('atlantis', DEFAULT_GRID, calls as typeof fetch)).rejects.toThrow(/Unknown place "atlantis"/);
    expect(calls).not.toHaveBeenCalled();
    const status = (code: number) => (async () => new Response('x', { status: code })) as typeof fetch;
    await expect(loadBakedPlace('hue', DEFAULT_GRID, status(404))).rejects.toThrow(/Hue.*HTTP 404/);
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    await expect(loadBakedPlace('hue', DEFAULT_GRID, offline)).rejects.toThrow(/Could not download map "Hue": Failed to fetch/);
    const garbage = (async () => new Response(new Uint8Array(64))) as typeof fetch;
    await expect(loadBakedPlace('hue', DEFAULT_GRID, garbage)).rejects.toThrow(/corrupt/);
    await expect(loadBakedPlace('hue', { width: 0, height: 10 }, diskFetch)).rejects.toThrow(RangeError);
  });
});

describe('public/places manifest', () => {
  const manifest = JSON.parse(readFileSync(`${PLACES_DIR}manifest.json`, 'utf8'));

  it('lists every catalog place with its baked file', () => {
    expect(manifest.places.map((p: { id: string }) => p.id)).toEqual(REAL_PLACES.map((p) => p.id));
    for (const entry of manifest.places) {
      const place = findRealPlace(entry.id)!;
      expect(entry.file).toBe(`${entry.id}.bin`);
      expect(statSync(PLACES_DIR + entry.file).size).toBe(24 + entry.width * entry.height * 2);
      expect([entry.width, entry.height]).toEqual([256, 192]);
      expect(entry.bbox.west).toBeLessThan(place.lon);
      expect(entry.bbox.east).toBeGreaterThan(place.lon);
      expect(entry.bbox.south).toBeLessThan(place.lat);
      expect(entry.bbox.north).toBeGreaterThan(place.lat);
      expect(entry.maxMeters).toBeGreaterThan(entry.minMeters);
    }
  });

  it('keeps the baked data within the 1.5 MB budget', () => {
    const total = readdirSync(PLACES_DIR).reduce((n, f) => n + statSync(PLACES_DIR + f).size, 0);
    expect(total).toBeLessThanOrEqual(1.5 * 1024 * 1024);
  });
});
