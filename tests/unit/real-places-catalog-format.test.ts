import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID } from '../../src/core/types';
import { placeMercatorBox, globalPixelXToLon, globalPixelYToLat } from '../../src/game/place-terrain-resampling';
import {
  TERRAIN_SOURCE_FLAGS as F,
  attributionForSourceFlags,
  sourceFlagForImagery,
  sourceFlagsFromImageryHeader,
} from '../../src/game/real-place-attribution';
import { BAKED_PLACE_HEADER_BYTES, BakedPlaceFormatError, decodeBakedPlace, encodeBakedPlace } from '../../src/game/real-place-baked-format';
import { REAL_PLACES, TERRAIN_ATTRIBUTION, placeUV } from '../../src/game/real-places';

describe('real places catalog', () => {
  it('ships exactly the eight curated places', () => {
    expect(REAL_PLACES.map((p) => p.id)).toEqual([
      'ha-long-bay',
      'hoi-an',
      'hue',
      'fansipan',
      'grand-canyon',
      'mount-fuji',
      'yosemite',
      'mount-st-helens',
    ]);
  });

  it('has sane frames and Vietnamese names for Vietnamese places', () => {
    for (const p of REAL_PLACES) {
      expect(p.name.length).toBeGreaterThan(2);
      expect(p.blurb.length).toBeGreaterThan(30);
      expect(Math.abs(p.lat)).toBeLessThan(80);
      expect(Math.abs(p.lon)).toBeLessThanOrEqual(180);
      expect(p.widthKm).toBeGreaterThanOrEqual(10);
      expect(p.widthKm).toBeLessThanOrEqual(50);
      if (p.country === 'Vietnam') expect(p.nameVi).toBeTruthy();
    }
  });
});

describe('placeUV', () => {
  const yosemite = REAL_PLACES.find((p) => p.id === 'yosemite')!;

  it('maps the frame centre to the grid centre and north to smaller v', () => {
    const c = placeUV(yosemite, DEFAULT_GRID, yosemite.lat, yosemite.lon);
    expect(c.u).toBeCloseTo(0.5, 9);
    expect(c.v).toBeCloseTo(0.5, 9);
    const north = placeUV(yosemite, DEFAULT_GRID, yosemite.lat + 0.01, yosemite.lon);
    const east = placeUV(yosemite, DEFAULT_GRID, yosemite.lat, yosemite.lon + 0.01);
    expect(north.v).toBeLessThan(0.5);
    expect(east.u).toBeGreaterThan(0.5);
  });

  it('maps the frame corners to 0 and 1 at any zoom', () => {
    const box = placeMercatorBox(yosemite, DEFAULT_GRID, 12);
    const tl = placeUV(yosemite, DEFAULT_GRID, globalPixelYToLat(box.top, 12), globalPixelXToLon(box.left, 12));
    const br = placeUV(yosemite, DEFAULT_GRID, globalPixelYToLat(box.top + box.height, 12), globalPixelXToLon(box.left + box.width, 12));
    expect(tl.u).toBeCloseTo(0, 6);
    expect(tl.v).toBeCloseTo(0, 6);
    expect(br.u).toBeCloseTo(1, 6);
    expect(br.v).toBeCloseTo(1, 6);
  });

  it('puts famous landmarks inside their frames', () => {
    const inside = (id: string, lat: number, lon: number) => {
      const { u, v } = placeUV(REAL_PLACES.find((p) => p.id === id)!, DEFAULT_GRID, lat, lon);
      return u > 0.05 && u < 0.95 && v > 0.05 && v < 0.95;
    };
    expect(inside('yosemite', 37.7459, -119.5332)).toBe(true); // Half Dome
    expect(inside('yosemite', 37.734, -119.6377)).toBe(true); // El Capitan
    expect(inside('hoi-an', 15.877, 108.326)).toBe(true); // ancient town
    expect(inside('hue', 16.4698, 107.5776)).toBe(true); // imperial citadel
    expect(inside('grand-canyon', 36.0544, -112.1401)).toBe(true); // Grand Canyon Village
    expect(inside('mount-st-helens', 46.1914, -122.1956)).toBe(true); // summit
    expect(inside('ha-long-bay', 20.91, 107.18)).toBe(true); // karst islands
  });

  it('takes the short way across the antimeridian', () => {
    const fiji = { lat: -16.8, lon: 179.95, widthKm: 30 };
    const east = placeUV(fiji, DEFAULT_GRID, -16.8, -179.95);
    expect(east.u).toBeGreaterThan(0.5);
    expect(east.u).toBeLessThan(1);
  });
});

describe('baked place binary format', () => {
  const meters = Float32Array.from({ length: 12 }, (_, i) => -20 + i * 37.3);

  it('round-trips heights within the uint16 quantization step', () => {
    const bytes = encodeBakedPlace({ meters, width: 4, height: 3, sourceFlags: F.srtm | F.etopo1, zoom: 12 });
    expect(bytes.byteLength).toBe(BAKED_PLACE_HEADER_BYTES + 24);
    const d = decodeBakedPlace(bytes.buffer as ArrayBuffer);
    expect([d.width, d.height, d.zoom, d.sourceFlags]).toEqual([4, 3, 12, F.srtm | F.etopo1]);
    const step = (d.maxMeters - d.minMeters) / 65535;
    meters.forEach((m, i) => expect(Math.abs(d.meters[i] - m)).toBeLessThanOrEqual(step));
    expect(d.minMeters).toBeLessThanOrEqual(-20);
  });

  it('handles perfectly flat data', () => {
    const flat = new Float32Array(6).fill(12.5);
    const d = decodeBakedPlace(encodeBakedPlace({ meters: flat, width: 3, height: 2, sourceFlags: 0, zoom: 1 }));
    expect(Array.from(d.meters)).toEqual(Array.from(flat));
  });

  it('rejects truncated, foreign and mismatched files', () => {
    const good = encodeBakedPlace({ meters, width: 4, height: 3, sourceFlags: 0, zoom: 1 });
    expect(() => decodeBakedPlace(good.slice(0, 10))).toThrow(BakedPlaceFormatError);
    expect(() => decodeBakedPlace(good.slice(0, good.length - 2))).toThrow(/does not match/);
    const foreign = good.slice();
    foreign[0] = 0x89;
    expect(() => decodeBakedPlace(foreign)).toThrow(/bad magic/);
    const future = good.slice();
    future[4] = 9;
    expect(() => decodeBakedPlace(future)).toThrow(/version 9/);
    expect(() => encodeBakedPlace({ meters, width: 5, height: 3, sourceFlags: 0, zoom: 1 })).toThrow(RangeError);
    expect(() => encodeBakedPlace({ meters: new Float32Array([NaN]), width: 1, height: 1, sourceFlags: 0, zoom: 1 })).toThrow(RangeError);
  });
});

describe('terrain attribution', () => {
  it('carries the required credits for every Terrain Tiles source', () => {
    for (const credit of ['Mapzen', 'SRTM', 'GMTED2010', '3DEP', 'U.S. Geological Survey', 'ETOPO1', 'ArcticDEM', 'Geoscience Australia', 'EU-DEM', 'INEGI', 'Kartverket', 'Environment Agency', 'Open Government Licence – Canada', 'Land Information New Zealand', 'offene Daten Österreichs']) {
      expect(TERRAIN_ATTRIBUTION).toContain(credit);
    }
  });

  it('parses X-Imagery-Sources headers into source flags', () => {
    expect(sourceFlagForImagery('srtm/N21E107.tif')).toBe(F.srtm);
    expect(sourceFlagForImagery(' ned13/n37w120.tif')).toBe(F.usgs3dep);
    expect(sourceFlagForImagery('eudem/x.tif')).toBe(F.other);
    expect(sourceFlagForImagery('')).toBe(0);
    expect(sourceFlagsFromImageryHeader('srtm/a.tif, gmted/b.tif,etopo1/c.tif')).toBe(F.srtm | F.gmted | F.etopo1);
    expect(sourceFlagsFromImageryHeader(null)).toBe(0);
  });

  it('credits only the contributing sources, or everything when unsure', () => {
    const vn = attributionForSourceFlags(F.srtm | F.gmted);
    expect(vn).toContain('global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey');
    expect(vn).not.toContain('ETOPO1');
    expect(attributionForSourceFlags(F.usgs3dep)).toContain('United States 3DEP (formerly NED)');
    expect(attributionForSourceFlags(F.srtm | F.etopo1)).toContain('National Oceanic and Atmospheric Administration');
    expect(attributionForSourceFlags(0)).toBe(TERRAIN_ATTRIBUTION);
    expect(attributionForSourceFlags(F.srtm | F.other)).toBe(TERRAIN_ATTRIBUTION);
  });
});
