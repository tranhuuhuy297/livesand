import { describe, expect, it } from 'vitest';
import { parseAppUrlParams } from '../../src/app/app-url-params';
import { cleanPlaceName, clampPlaceWidthKm, coarsenDeviceLocation, formatLatLon, formatPlaceParam, parseLatLon, parsePlaceParam } from '../../src/app/place-url-param';
import { describePlace, startupLevels } from '../../src/app/virtual-level-flow';
import { defaultToolFor, PLACE_SEA_PALETTE_T, placeRenderStyle } from '../../src/app/virtual-mode-presets';
import { BLANK_SANDBOX_LEVEL, getLevel } from '../../src/game/level-definitions';
import { placeDisplayName, placeLevelId, realPlaceFreePlayLevel } from '../../src/game/real-place-levels';
import { findRealPlace, type PlaceTerrain } from '../../src/game/real-places';
import { SEA_LEVEL_OFF } from '../../src/render/shading-common-wgsl';
import { fakeTerrain, flowWithFakes } from './level-flow-test-fakes';

describe('?place= links', () => {
  it('coarsens a device location to ~1 km before it reaches a lookup or a link', () => {
    expect(coarsenDeviceLocation(16.048731, 108.204129)).toEqual({ lat: 16.05, lon: 108.2 });
    expect(coarsenDeviceLocation(-33.868821, 151.209296)).toEqual({ lat: -33.87, lon: 151.21 });
  });

  it('parses catalogue ids and coordinates with an optional width', () => {
    expect(parsePlaceParam('ha-long-bay')).toEqual({ kind: 'place', id: 'ha-long-bay' });
    expect(parsePlaceParam(' Hoi-An ')).toEqual({ kind: 'place', id: 'hoi-an' });
    expect(parsePlaceParam('16.05,108.2')).toEqual({ kind: 'live', lat: 16.05, lon: 108.2, widthKm: 20 });
    expect(parsePlaceParam('-33.9,151.2,35')).toEqual({ kind: 'live', lat: -33.9, lon: 151.2, widthKm: 35 });
    expect(parsePlaceParam('10,20,5000')).toMatchObject({ widthKm: 100 });
    for (const bad of [null, '', 'atlantis', '95,10', '10,200', '10', '1,2,3,4', 'a,b']) expect(parsePlaceParam(bad)).toBeNull();
  });

  it('formats links that parse back, and readable coordinates', () => {
    const live = { kind: 'live', lat: 16.047123, lon: 108.206789, widthKm: 12.34 } as const;
    expect(formatPlaceParam(live)).toBe('16.04712,108.20679,12.3');
    expect(parsePlaceParam(formatPlaceParam(live))).toMatchObject({ lat: 16.04712, lon: 108.20679, widthKm: 12.3 });
    expect(formatPlaceParam({ kind: 'place', id: 'hue' })).toBe('hue');
    expect(formatLatLon(-12.5, -77.03)).toBe('12.500°S 77.030°W');
    expect(parseLatLon('21.03 105.85')).toEqual({ lat: 21.03, lon: 105.85 });
    expect(parseLatLon('21.03;105.85')).toEqual({ lat: 21.03, lon: 105.85 });
    expect(clampPlaceWidthKm(Number.NaN)).toBe(20);
    expect(clampPlaceWidthKm(0.1)).toBe(2);
  });

  it('startup: plain levels load at once; real maps start from blank sand and download', () => {
    const at = (search: string) => startupLevels(parseAppUrlParams(search));
    expect(at('?level=twin-towns')).toEqual({ level: getLevel('twin-towns'), pending: null });
    expect(at('')).toMatchObject({ level: { id: 'first-flood' }, pending: null });
    expect(at('?level=hoi-an-floods')).toEqual({ level: BLANK_SANDBOX_LEVEL, pending: { kind: 'level', id: 'hoi-an-floods' } });
    expect(at('?place=hue&level=twin-towns')).toEqual({ level: BLANK_SANDBOX_LEVEL, pending: { kind: 'place', id: 'hue' } });
    expect(at('?place=nowhere&level=twin-towns').pending).toBeNull();
  });
});

describe('real-place free play levels', () => {
  it('names Vietnamese places in Vietnamese and builds free play on the map', () => {
    expect(placeDisplayName(findRealPlace('ha-long-bay')!)).toBe('Vịnh Hạ Long');
    expect(placeDisplayName(findRealPlace('yosemite')!)).toBe('Yosemite Valley');
    expect(describePlace({ kind: 'place', id: 'hue' })).toBe('Huế');
    expect(placeLevelId({ lat: 1, lon: 2, widthKm: 3 })).toBe('place-custom');
    const edges = { north: true, east: false, south: false, west: false };
    const level = realPlaceFreePlayLevel({ id: 'hue' }, edges, 'Huế', 'blurb');
    expect(level).toMatchObject({ id: 'place-hue', villages: [], place: { id: 'hue' }, openEdges: edges, durationSec: Infinity });
    expect(level.openEdges).not.toBe(edges);
  });

  it('render style keeps the procedural palette above sea level and hides the sea inland', () => {
    const delta = placeRenderStyle({ seaLevel: 2, maxHeight: 8.7 }, 30);
    expect(delta).toMatchObject({ seaLevel: 2, maxHeight: 29 });
    expect(delta.verticalScale).toBe(3);
    // Sea level sits just above the light-cyan shallows stop, so low coastal land reads green, not flooded.
    const t = (h: number) => (h - delta.minHeight!) / (delta.maxHeight! - delta.minHeight!);
    expect(t(2)).toBeCloseTo(PLACE_SEA_PALETTE_T, 6);
    expect(t(2)).toBeGreaterThan(0.27);
    const peak = placeRenderStyle({ seaLevel: 0, maxHeight: 32 }, 30);
    expect(peak).toMatchObject({ seaLevel: SEA_LEVEL_OFF, maxHeight: 32, verticalScale: 1.5 });
  });

  it('starts each level with the tool its briefing asks for', () => {
    expect(defaultToolFor(getLevel('mount-ember'))).toBe('raise');
    expect(defaultToolFor(getLevel('hoi-an-floods'))).toBe('raise');
    expect(defaultToolFor(getLevel('first-flood'))).toBe('lower');
    expect(defaultToolFor(getLevel('sandbox'))).toBe('raise');
  });
});

describe('VirtualLevelFlow', () => {
  it('switches procedural levels at once and real maps after the download, with a loading label meanwhile', async () => {
    let release!: (t: PlaceTerrain) => void;
    const { flow, loaded, host } = flowWithFakes({ bakedPlace: () => new Promise((resolve) => (release = resolve)) });
    expect(await flow.request({ kind: 'level', id: 'twin-towns' })).toBe('applied');
    expect(loaded.at(-1)!.level.id).toBe('twin-towns');
    const pending = flow.request({ kind: 'place', id: 'ha-long-bay' });
    expect(flow.loading).toBe('Vịnh Hạ Long');
    release(fakeTerrain(5));
    expect(await pending).toBe('applied');
    expect(flow.loading).toBeNull();
    expect(loaded.at(-1)).toMatchObject({ level: { id: 'place-ha-long-bay', name: 'Vịnh Hạ Long' } });
    expect(flow.place).toMatchObject({ name: 'Vịnh Hạ Long', link: { kind: 'place', id: 'ha-long-bay' } });
    expect(flow.sculptMax).toBe(30);
    expect(host.onLevelApplied).toHaveBeenCalledTimes(2);
  });

  it('a failed download keeps the current level and says why; a newer request wins over an older one', async () => {
    const { flow, loaded, host } = flowWithFakes({
      bakedPlace: (id: string) => (id === 'hue' ? Promise.reject(new Error('HTTP 404')) : new Promise((r) => setTimeout(() => r(fakeTerrain(40)), 5))),
      livePlace: async () => fakeTerrain(7),
    });
    expect(await flow.request({ kind: 'place', id: 'hue' })).toBe('failed');
    expect(host.showToast).toHaveBeenCalledWith("Couldn't load Huế: HTTP 404");
    expect(loaded).toHaveLength(0);
    const older = flow.request({ kind: 'level', id: 'hoi-an-floods' });
    const newer = flow.request({ kind: 'live', lat: 10, lon: 20, widthKm: 15 });
    expect(await newer).toBe('applied');
    expect(await older).toBe('superseded');
    expect(loaded.map((l) => l.level.id)).toEqual(['place-custom']);
    expect(flow.place?.link).toEqual({ kind: 'live', lat: 10, lon: 20, widthKm: 15 });
  });
});

describe('place names in links', () => {
  it('labels shared coordinates with a clean, one-line name', () => {
    expect(parsePlaceParam('16.05,108.2,20', ' Đà  Nẵng ')).toEqual({ kind: 'live', lat: 16.05, lon: 108.2, widthKm: 20, name: 'Đà Nẵng' });
    expect(parsePlaceParam('16.05,108.2', '   ')).toEqual({ kind: 'live', lat: 16.05, lon: 108.2, widthKm: 20 });
    expect(parsePlaceParam('hue', 'Somewhere else')).toEqual({ kind: 'place', id: 'hue' });
    expect(cleanPlaceName('a\nb\u0007c')).toBe('a b c');
    expect(cleanPlaceName('x'.repeat(80))).toHaveLength(60);
    expect(describePlace({ kind: 'live', lat: 16.05, lon: 108.2, widthKm: 20, name: 'Đà Nẵng' })).toBe('Đà Nẵng');
    const params = parseAppUrlParams('?place=16.05,108.2,20&name=%C4%90%C3%A0%20N%E1%BA%B5ng');
    expect(startupLevels(params).pending).toMatchObject({ kind: 'live', name: 'Đà Nẵng' });
  });
});
