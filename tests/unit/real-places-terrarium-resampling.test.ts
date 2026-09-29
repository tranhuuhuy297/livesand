import { describe, expect, it } from 'vitest';
import {
  chooseTileZoom,
  globalPixelXToLon,
  globalPixelYToLat,
  latToGlobalPixelY,
  lonToGlobalPixelX,
  metersPerMercatorPixel,
  placeMercatorBox,
  placeMetersPerCell,
  resampleGrid,
  resampleMosaicToGrid,
  sampleBilinear,
  stitchTiles,
  tilesCoveringBox,
} from '../../src/game/place-terrain-resampling';
import { decodeTerrariumMeters } from '../../src/game/real-places';
import { TERRARIUM_TILE_SIZE, decodeTerrariumRgba, encodeTerrariumMeters, terrariumTileUrl } from '../../src/game/terrarium-decoding';

const GRID = { width: 256, height: 192 };

describe('terrarium decoding', () => {
  it('decodes r*256 + g + b/256 - 32768', () => {
    expect(decodeTerrariumMeters(128, 0, 0)).toBe(0);
    expect(decodeTerrariumMeters(0, 0, 0)).toBe(-32768);
    expect(decodeTerrariumMeters(255, 255, 255)).toBeCloseTo(32767.996, 3);
    expect(decodeTerrariumMeters(140, 197, 128)).toBeCloseTo(3269.5, 6);
    expect(decodeTerrariumMeters(127, 246, 0)).toBe(-10);
  });

  it('round-trips through the encoder within 1/256 m', () => {
    for (const m of [-10994, -32.25, -0.5, 0, 0.004, 1, 2.75, 3776.2, 8848.86]) {
      const [r, g, b] = encodeTerrariumMeters(m);
      expect(Math.abs(decodeTerrariumMeters(r, g, b) - m)).toBeLessThanOrEqual(1 / 256);
    }
  });

  it('decodes RGBA buffers per pixel and validates sizes', () => {
    const rgba = new Uint8ClampedArray([128, 0, 0, 255, 128, 100, 128, 255, 127, 255, 0, 255, 129, 0, 0, 255]);
    expect(Array.from(decodeTerrariumRgba(rgba, 2, 2))).toEqual([0, 100.5, -1, 256]);
    expect(() => decodeTerrariumRgba(rgba, 3, 2)).toThrow(RangeError);
    expect(() => decodeTerrariumRgba(rgba, 0, 2)).toThrow(RangeError);
  });

  it('builds AWS Terrarium tile URLs', () => {
    expect(terrariumTileUrl(11, 1633, 900)).toBe('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/11/1633/900.png');
  });
});

describe('web mercator framing', () => {
  it('maps lon/lat to global pixels and back', () => {
    expect(lonToGlobalPixelX(0, 0)).toBe(128);
    expect(latToGlobalPixelY(0, 0)).toBeCloseTo(128, 9);
    expect(lonToGlobalPixelX(-180, 3)).toBe(0);
    for (const [lat, lon] of [[20.88, 107.1], [-33.9, 18.4], [46.2, -122.2]]) {
      expect(globalPixelYToLat(latToGlobalPixelY(lat, 12), 12)).toBeCloseTo(lat, 9);
      expect(globalPixelXToLon(lonToGlobalPixelX(lon, 12), 12)).toBeCloseTo(lon, 9);
    }
    expect(latToGlobalPixelY(60, 0)).toBeLessThan(latToGlobalPixelY(10, 0)); // north is up (smaller y)
  });

  it('uses the standard ground resolution table', () => {
    expect(metersPerMercatorPixel(0, 0)).toBeCloseTo(156543.03, 1);
    expect(metersPerMercatorPixel(45, 10)).toBeCloseTo(108.1, 1);
    expect(metersPerMercatorPixel(60, 12)).toBeCloseTo(19.1, 1);
  });

  it('picks the lowest zoom whose pixels are at least as fine as a cell', () => {
    for (const frame of [{ lat: 15.88, lon: 108.35, widthKm: 14 }, { lat: 35.38, lon: 138.73, widthKm: 40 }, { lat: 0, lon: 0, widthKm: 300 }]) {
      const z = chooseTileZoom(frame, GRID);
      const cell = placeMetersPerCell(frame, GRID);
      expect(metersPerMercatorPixel(frame.lat, z)).toBeLessThanOrEqual(cell);
      expect(metersPerMercatorPixel(frame.lat, z - 1)).toBeGreaterThan(cell);
    }
    expect(chooseTileZoom({ lat: 10, lon: 10, widthKm: 0.5 }, GRID)).toBe(15);
  });

  it('frames a square-cell 4:3 box centred on the place', () => {
    const frame = { lat: 36.1, lon: -112.1, widthKm: 30 };
    const box = placeMercatorBox(frame, GRID, 11);
    expect(box.width * metersPerMercatorPixel(frame.lat, 11)).toBeCloseTo(30000, 3);
    expect(box.height / box.width).toBeCloseTo(191 / 255, 12);
    expect(box.left + box.width / 2).toBeCloseTo(lonToGlobalPixelX(frame.lon, 11), 9);
    expect(box.top + box.height / 2).toBeCloseTo(latToGlobalPixelY(frame.lat, 11), 9);
  });

  it('lists covering tiles with an apron and wraps across the antimeridian', () => {
    const box = { zoom: 2, left: 250, top: 300, width: 300, height: 250 };
    const cover = tilesCoveringBox(box);
    expect(cover.columns).toBe(3);
    expect(cover.rows).toBe(2);
    expect(cover.originX).toBe(0);
    expect(cover.tiles.map((t) => `${t.x},${t.y}`)).toEqual(['0,1', '1,1', '2,1', '0,2', '1,2', '2,2']);
    const wrapped = tilesCoveringBox({ zoom: 2, left: -100, top: 10, width: 200, height: 100 });
    expect(wrapped.tiles.map((t) => t.x)).toEqual([3, 0]);
    expect(wrapped.originX).toBe(-256);
  });
});

describe('stitching and resampling', () => {
  const S = TERRARIUM_TILE_SIZE;
  const tile = (fn: (x: number, y: number) => number) => Float32Array.from({ length: S * S }, (_, i) => fn(i % S, Math.floor(i / S)));

  it('stitches tiles row-major into one mosaic', () => {
    const tiles = [0, 1, 2, 3].map((k) => tile((x, y) => k * 1000 + y * S + x));
    const m = stitchTiles(tiles, 2, 2, 512, 768);
    expect(m.width).toBe(2 * S);
    expect(m.height).toBe(2 * S);
    expect(m.meters[0]).toBe(0);
    expect(m.meters[S + 5]).toBe(1005);
    expect(m.meters[S * m.width + 7]).toBe(2007);
    expect(m.meters[(S + 3) * m.width + S + 4]).toBe(3000 + 3 * S + 4);
    expect(() => stitchTiles(tiles, 3, 2, 0, 0)).toThrow(RangeError);
    expect(() => stitchTiles([new Float32Array(10)], 1, 1, 0, 0)).toThrow(RangeError);
  });

  it('samples pixel centres exactly (a linear ramp resamples to the sample position)', () => {
    const originX = 3 * S;
    const originY = 5 * S;
    const ramp = stitchTiles([tile((x) => originX + x + 0.5), tile((x) => originX + S + x + 0.5)], 2, 1, originX, originY);
    const box = { zoom: 5, left: originX + 40.25, top: originY + 10, width: 300, height: 300 * (191 / 255) };
    const out = resampleMosaicToGrid(ramp, box, GRID);
    for (const x of [0, 1, 100, 255]) expect(out[7 * GRID.width + x]).toBeCloseTo(box.left + (x * box.width) / 255, 3);
  });

  it('bilinear sampling interpolates and clamps at the borders', () => {
    const v = new Float32Array([0, 10, 20, 30]);
    expect(sampleBilinear(v, 2, 2, 0.5, 0.5)).toBe(15);
    expect(sampleBilinear(v, 2, 2, -3, -3)).toBe(0);
    expect(sampleBilinear(v, 2, 2, 9, 9)).toBe(30);
  });

  it('resamples grids in normalised coordinates', () => {
    const from = { width: 5, height: 3 };
    const ramp = Float32Array.from({ length: 15 }, (_, i) => (i % 5) * 10 + Math.floor(i / 5));
    expect(resampleGrid(ramp, from, from)).toEqual(ramp);
    const out = resampleGrid(ramp, from, { width: 9, height: 5 });
    expect(out[0]).toBe(0);
    expect(out[8]).toBe(40);
    expect(out[4 * 9 + 8]).toBe(42);
    expect(out[2 * 9 + 3]).toBeCloseTo(16, 6);
  });

  it('keeps square cells when the target aspect differs (centre rows line up, extra rows clamp)', () => {
    const from = { width: 5, height: 3 };
    const ramp = Float32Array.from({ length: 15 }, (_, i) => (i % 5) * 10 + Math.floor(i / 5));
    const square = resampleGrid(ramp, from, { width: 5, height: 5 });
    expect(Array.from(square.subarray(10, 15))).toEqual([1, 11, 21, 31, 41]);
    expect(Array.from(square.subarray(0, 5))).toEqual([0, 10, 20, 30, 40]);
    expect(Array.from(square.subarray(20, 25))).toEqual([2, 12, 22, 32, 42]);
  });
});
