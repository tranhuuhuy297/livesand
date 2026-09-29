import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  chooseTileZoom,
  lonToGlobalPixelX,
  placeMercatorBox,
  placeMetersPerCell,
  tilesCoveringBox,
} from '../../src/game/place-terrain-resampling';
import { fetchPlaceMeters, type PngRgbaDecoder } from '../../src/game/real-place-tile-fetching';
import { TERRAIN_ATTRIBUTION, loadLivePlace, loadLivePlaceWithDecoder } from '../../src/game/real-places';
import { TERRARIUM_TILE_SIZE, encodeTerrariumMeters } from '../../src/game/terrarium-decoding';

// pngjs ships without type declarations; this is the slice of its API the tests use.
interface PngImage { width: number; height: number; data: Uint8Array }
interface PngJs {
  PNG: { new (opts: { width: number; height: number }): PngImage; sync: { read(buf: Buffer): PngImage; write(png: PngImage): Buffer } };
}
const { PNG } = createRequire(import.meta.url)('pngjs') as PngJs;

const S = TERRARIUM_TILE_SIZE;
const GRID = { width: 64, height: 48 };
const FRAME = { lat: 10, lon: 100, widthKm: 20 };
const TILE_URL = /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png$/;

const decodeWithPngjs: PngRgbaDecoder = async (png) => {
  const img = PNG.sync.read(Buffer.from(png));
  return { rgba: img.data, width: img.width, height: img.height };
};

/** Terrarium PNG for one tile of a synthetic world whose elevation is a function of global pixel coordinates. */
function syntheticTilePng(z: number, tx: number, ty: number, elevation: (gx: number, gy: number, z: number) => number): Uint8Array<ArrayBuffer> {
  const png = new PNG({ width: S, height: S });
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const [r, g, b] = encodeTerrariumMeters(elevation(tx * S + x + 0.5, ty * S + y + 0.5, z));
      png.data.set([r, g, b, 255], (y * S + x) * 4);
    }
  }
  return new Uint8Array(PNG.sync.write(png));
}

function tileServer(elevation: (gx: number, gy: number, z: number) => number) {
  const requested: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    const m = TILE_URL.exec(url);
    if (!m) return new Response('bad url', { status: 400 });
    return new Response(syntheticTilePng(+m[1], +m[2], +m[3], elevation));
  }) as typeof fetch;
  return { fetchImpl, requested };
}

// A coast through the frame centre: land rises 20 m per zoom-level pixel to the west, the sea deepens to the east.
const coastCentreX = (z: number) => lonToGlobalPixelX(FRAME.lon, z);
const coast = (gx: number, _gy: number, z: number) => (coastCentreX(z) - gx) * 20;

describe('live terrain tiles', () => {
  it('fetches exactly the covering Terrarium tiles and resamples them onto the grid', async () => {
    const { fetchImpl, requested } = tileServer(coast);
    const result = await fetchPlaceMeters(FRAME, GRID, fetchImpl, decodeWithPngjs);
    const zoom = chooseTileZoom(FRAME, GRID);
    const box = placeMercatorBox(FRAME, GRID, zoom);
    expect(result.zoom).toBe(zoom);
    expect(requested.sort()).toEqual(tilesCoveringBox(box).tiles.map((t) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${t.z}/${t.x}/${t.y}.png`).sort());
    for (const x of [0, 13, 31, 50, 63]) {
      const expected = coast(box.left + (x * box.width) / (GRID.width - 1), 0, zoom);
      expect(result.meters[20 * GRID.width + x]).toBeCloseTo(expected, 1);
    }
  });

  it('builds a coastal PlaceTerrain with the sea draining out of the east edge', async () => {
    const { fetchImpl } = tileServer(coast);
    const t = await loadLivePlaceWithDecoder(FRAME, GRID, fetchImpl, decodeWithPngjs);
    expect(t.heights).toHaveLength(GRID.width * GRID.height);
    expect(t.seaLevel).toBe(2);
    expect(t.openEdges).toEqual({ north: true, east: true, south: true, west: false });
    expect(t.metersPerCell).toBeCloseTo(placeMetersPerCell(FRAME, GRID), 9);
    expect(t.attribution).toBe(TERRAIN_ATTRIBUTION);
    const row = Array.from(t.heights.subarray(24 * GRID.width, 25 * GRID.width));
    expect(row[0]).toBeGreaterThan(30);
    expect(row[10]).toBeGreaterThan(row[20]);
    expect(row[20]).toBeGreaterThan(t.seaLevel);
    expect(row[45]).toBeLessThan(t.seaLevel);
  });

  it('honours an explicit vertical exaggeration', async () => {
    const { fetchImpl } = tileServer(coast);
    const t = await loadLivePlaceWithDecoder({ ...FRAME, verticalExaggeration: 1 }, GRID, fetchImpl, decodeWithPngjs);
    expect(t.metersPerUnitVertical).toBeCloseTo(t.metersPerCell, 9);
  });

  it('reports HTTP errors, network failures and malformed tiles', async () => {
    const down = (async () => new Response('', { status: 503 })) as typeof fetch;
    await expect(loadLivePlaceWithDecoder(FRAME, GRID, down, decodeWithPngjs)).rejects.toThrow(/HTTP 503/);
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    await expect(loadLivePlaceWithDecoder(FRAME, GRID, offline, decodeWithPngjs)).rejects.toThrow(/Could not download terrain tile .*Failed to fetch/);
    const { fetchImpl } = tileServer(coast);
    const tiny: PngRgbaDecoder = async () => ({ rgba: new Uint8Array(16), width: 2, height: 2 });
    await expect(loadLivePlaceWithDecoder(FRAME, GRID, fetchImpl, tiny)).rejects.toThrow(/expected 256px/);
  });

  it('validates the frame and grid before downloading anything', async () => {
    const { fetchImpl, requested } = tileServer(coast);
    await expect(loadLivePlaceWithDecoder({ lat: 91, lon: 0, widthKm: 10 }, GRID, fetchImpl, decodeWithPngjs)).rejects.toThrow(RangeError);
    await expect(loadLivePlaceWithDecoder({ lat: 0, lon: 0, widthKm: 0 }, GRID, fetchImpl, decodeWithPngjs)).rejects.toThrow(RangeError);
    await expect(loadLivePlaceWithDecoder(FRAME, { width: 1, height: 1 }, fetchImpl, decodeWithPngjs)).rejects.toThrow(RangeError);
    expect(requested).toHaveLength(0);
  });

  it('explains that the browser decoder needs createImageBitmap when it is missing (Node)', async () => {
    const { fetchImpl } = tileServer(coast);
    await expect(loadLivePlace(FRAME.lat, FRAME.lon, FRAME.widthKm, GRID, fetchImpl)).rejects.toThrow(/createImageBitmap/);
  });
});
