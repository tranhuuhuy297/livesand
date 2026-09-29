import { describe, expect, it, vi } from 'vitest';
import type { PlaceTerrain } from '../../src/game/real-places';
import { deferred, fakeTerrain, flowWithFakes } from './level-flow-test-fakes';

describe('VirtualLevelFlow startup and cancellation', () => {
  it('a level picked while the startup map downloads stays, whether that download later lands or fails', async () => {
    for (const outcome of ['lands', 'fails'] as const) {
      const hue = deferred<PlaceTerrain>();
      const { flow, loaded, host } = flowWithFakes({ bakedPlace: () => hue.promise }, { kind: 'place', id: 'hue' });
      const startup = flow.loadStartupLevel();
      expect(flow.loading).toBe('Huế');
      expect(await flow.request({ kind: 'level', id: 'mount-ember' })).toBe('applied');
      if (outcome === 'lands') hue.resolve(fakeTerrain(5));
      else hue.reject(new Error('HTTP 503'));
      await startup;
      expect(loaded.map((l) => l.level.id)).toEqual(['mount-ember']);
      expect(host.showToast).not.toHaveBeenCalled();
      expect(flow.loading).toBeNull();
    }
  });

  it('falls back to the first level only when the startup map itself fails', async () => {
    const { flow, loaded, host } = flowWithFakes({ bakedPlace: () => Promise.reject(new Error('HTTP 404')) }, { kind: 'place', id: 'hue' });
    await flow.loadStartupLevel();
    expect(loaded.map((l) => l.level.id)).toEqual(['first-flood']);
    expect(host.showToast).toHaveBeenCalledWith("Couldn't load Huế: HTTP 404");
  });

  it('stops the tile downloads of a live map once a newer map is picked', async () => {
    const signals: AbortSignal[] = [];
    const { flow, loaded } = flowWithFakes({
      livePlace: (_lat: number, _lon: number, _km: number, signal?: AbortSignal) => {
        signals.push(signal!);
        return new Promise<PlaceTerrain>((_, reject) => signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      },
    });
    const first = flow.request({ kind: 'live', lat: 10, lon: 20, widthKm: 15 });
    expect(signals[0].aborted).toBe(false);
    expect(await flow.request({ kind: 'level', id: 'twin-towns' })).toBe('applied');
    expect(signals[0].aborted).toBe(true);
    expect(await first).toBe('superseded');
    expect(loaded.map((l) => l.level.id)).toEqual(['twin-towns']);
  });

  it('builds the storm challenge on the open place without downloading again, and returns to free play', async () => {
    const bakedPlace = vi.fn(async () => fakeTerrain(5));
    const { flow, loaded } = flowWithFakes({ bakedPlace });
    expect(flow.startStorm()).toBe(false);
    await flow.request({ kind: 'place', id: 'hue' });
    expect(flow.hasFreePlace).toBe(true);
    expect(flow.startStorm()).toBe(true);
    const storm = loaded.at(-1)!;
    expect(storm.level).toMatchObject({ id: 'place-hue-storm', name: 'Storm over Huế', villages: [{ name: 'Huế' }], place: { id: 'hue' } });
    expect(storm.terrain).toBe(loaded[0].terrain);
    expect(flow.place?.link).toEqual({ kind: 'place', id: 'hue' });
    expect(flow.returnToPlace()).toBe(true);
    expect(loaded.at(-1)!.level).toBe(loaded[0].level);
    expect(bakedPlace).toHaveBeenCalledTimes(1);
    await flow.request({ kind: 'level', id: 'twin-towns' });
    expect(flow.hasFreePlace).toBe(false);
  });
});

