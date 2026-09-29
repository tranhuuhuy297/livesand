import { afterEach, describe, expect, it, vi } from 'vitest';
import { foldAccents } from '../../src/app/hud-real-places-menu';
import { hintVisible } from '../../src/app/level-hint-overlay';
import { parsePhotonResults, parsePhotonReverseName, PHOTON_URL, reverseGeocode, searchPlaces } from '../../src/app/place-name-geocoder';
import { ashLevelOf, stormLevelOf } from '../../src/app/session-atmosphere';
import { shareLink } from '../../src/app/share-link';
import { DEFAULT_GRID } from '../../src/core/types';
import { getLevel } from '../../src/game/level-definitions';
import { VillageFloodGame } from '../../src/game/village-flood-game';
import { DEFAULT_LAVA_SIM_PARAMS, LAVA_NO_SEA, mergeLavaSimParams } from '../../src/gpu/lava-sim-params';
import { packLavaParams } from '../../src/gpu/lava-sim-shaders';

const feature = (lon: number, lat: number, properties: Record<string, unknown>) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties });

describe('place search (Photon)', () => {
  it('turns results into named places with the region that tells them apart and a width from the extent', () => {
    const json = {
      features: [
        feature(108.33, 15.88, { name: 'Hội An', type: 'district', city: 'Đà Nẵng', country: 'Việt Nam' }),
        feature(108.34, 15.89, { name: 'Thành phố Hội An', county: 'Hòn Cụ', country: 'Việt Nam', extent: [108.29, 15.98, 108.4, 15.81] }),
        feature(200, 15, { name: 'Off the map' }),
        feature(1, 2, {}),
        { geometry: null },
      ],
    };
    const [town, city, ...rest] = parsePhotonResults(json);
    expect(town).toEqual({ name: 'Hội An', detail: 'Đà Nẵng, Việt Nam', lat: 15.88, lon: 108.33, widthKm: null });
    expect(city.widthKm).toBeGreaterThanOrEqual(20);
    expect(city.widthKm).toBeLessThanOrEqual(40);
    expect(rest).toEqual([]);
    expect(parsePhotonResults({ nope: true })).toEqual([]);
    expect(parsePhotonResults(null)).toEqual([]);
  });

  it('names a location fix after its town, not the shop it landed on', () => {
    expect(parsePhotonReverseName({ features: [feature(108.2, 16.05, { name: 'Techcombank ATM', type: 'house', district: 'Hòa Cường', city: 'Đà Nẵng' })] })).toBe('Đà Nẵng');
    expect(parsePhotonReverseName({ features: [feature(108.2, 16.05, { name: 'Huế', type: 'city' })] })).toBe('Huế');
    expect(parsePhotonReverseName({ features: [] })).toBeNull();
  });

  it('queries Photon with the encoded text and reports HTTP failures', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL) => new Response(JSON.stringify({ features: [feature(1, 2, { name: 'Đà Nẵng' })] })));
    const places = await searchPlaces('  Đà Nẵng ', undefined, fetchImpl as unknown as typeof fetch);
    expect(String(fetchImpl.mock.calls[0][0])).toBe(`${PHOTON_URL}/api/?q=${encodeURIComponent('Đà Nẵng')}&limit=6`);
    expect(places.map((p) => p.name)).toEqual(['Đà Nẵng']);
    expect(await searchPlaces('   ', undefined, fetchImpl as unknown as typeof fetch)).toEqual([]);
    const down = (async () => new Response('busy', { status: 503 })) as typeof fetch;
    await expect(reverseGeocode(16, 108, undefined, down)).rejects.toThrow(/HTTP 503/);
  });

  it('shows the English name under a Vietnamese one only when it is really different', () => {
    expect(foldAccents('Huế')).toBe(foldAccents('Hue'));
    expect(foldAccents('Đà Nẵng')).toBe('danang');
    expect(foldAccents('Phan Xi Păng')).not.toBe(foldAccents('Fansipan'));
  });
});

describe('sharing a map', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the system share sheet when there is one, and treats closing it as a choice', async () => {
    const share = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { share, canShare: () => true });
    expect(await shareLink('Huế in LiveSand', 'text', 'https://x/?place=hue')).toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 'Huế in LiveSand', text: 'text', url: 'https://x/?place=hue' });
    vi.stubGlobal('navigator', { share: async () => Promise.reject(new DOMException('closed', 'AbortError')) });
    expect(await shareLink('t', 'x', 'u')).toBe('cancelled');
  });

  it('falls back to copying the link without a share sheet', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await shareLink('t', 'x', 'https://x/')).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('https://x/');
  });
});

describe('level atmosphere and hints', () => {
  it('darkens the sky with ash while Mount Ember erupts, not before or on other levels', () => {
    const ember = getLevel('mount-ember');
    const game = new VillageFloodGame(ember, DEFAULT_GRID);
    expect(ashLevelOf(ember, game)).toBe(0);
    game.start();
    for (let t = 0; t < 20; t++) game.update(1, new Float32Array(1), new Float32Array(1));
    expect(ashLevelOf(ember, game)).toBeCloseTo(1, 5);
    const flood = new VillageFloodGame(getLevel('flash-flood'), DEFAULT_GRID);
    flood.start();
    for (let t = 0; t < 50; t++) flood.update(1, new Float32Array(3));
    expect(ashLevelOf(getLevel('flash-flood'), flood)).toBe(0);
    expect(stormLevelOf(getLevel('flash-flood'), flood, false)).toBeCloseTo(1, 5);
  });

  it('shows the build hint under the briefing and for the first seconds of an attempt only', () => {
    const ember = getLevel('mount-ember');
    expect(hintVisible(ember, 'ready', 0)).toBe(true);
    expect(hintVisible(ember, 'running', 5)).toBe(true);
    expect(hintVisible(ember, 'running', 30)).toBe(false);
    expect(hintVisible(ember, 'lost', 1)).toBe(false);
    expect(hintVisible(getLevel('first-flood'), 'ready', 0)).toBe(false);
  });
});

describe('lava in the painted sea', () => {
  it('packs the sea level for the quench test and rejects non-finite values', () => {
    expect(DEFAULT_LAVA_SIM_PARAMS.seaLevel).toBe(LAVA_NO_SEA);
    const params = mergeLavaSimParams(DEFAULT_LAVA_SIM_PARAMS, { seaLevel: 2 });
    expect(new Float32Array(packLavaParams(DEFAULT_GRID, params))[9]).toBe(2);
    expect(() => mergeLavaSimParams(DEFAULT_LAVA_SIM_PARAMS, { seaLevel: Number.NaN })).toThrow(RangeError);
  });
});
