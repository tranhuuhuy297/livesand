// Downloads real-place terrain for the sim grid: baked catalogue maps (cached per session) and live tiles for any
// lat/lon; every request gives up after a timeout so a stalled network cannot leave the loading state up forever, and
// live downloads stop as soon as the caller aborts (a newer map was picked).
import type { GridSize } from '../core/types';
import { loadBakedPlace, loadLivePlace, type PlaceTerrain } from '../game/real-places';

export const PLACE_DOWNLOAD_TIMEOUT_MS = 30_000;

/** Aborts when any input aborts (AbortSignal.any where available). */
export function anyAbortSignal(signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const live = signals.filter((s): s is AbortSignal => s !== undefined);
  if (live.length <= 1) return live[0];
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(live);
  const controller = new AbortController();
  for (const s of live) {
    if (s.aborted) controller.abort(s.reason);
    else s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

function fetchWithTimeout(caller?: AbortSignal): typeof fetch {
  return (input, init) => {
    const timeout = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(PLACE_DOWNLOAD_TIMEOUT_MS) : undefined;
    return fetch(input, { ...init, signal: anyAbortSignal([init?.signal ?? undefined, caller, timeout]) });
  };
}

export class PlaceTerrainLoader {
  private readonly grid: GridSize;
  private readonly baked = new Map<string, Promise<PlaceTerrain>>();

  constructor(grid: GridSize) {
    this.grid = grid;
  }

  /** Cached per id; a failed download is forgotten so the next attempt retries. */
  bakedPlace(id: string): Promise<PlaceTerrain> {
    let pending = this.baked.get(id);
    if (!pending) {
      // Never aborted: the one small file is cached for everyone who asks for this place.
      pending = loadBakedPlace(id, this.grid, fetchWithTimeout());
      this.baked.set(id, pending);
      pending.catch(() => this.baked.delete(id));
    }
    return pending;
  }

  /** `signal` stops the tile downloads (and so the decoding) once nobody wants this map any more. */
  livePlace(lat: number, lon: number, widthKm: number, signal?: AbortSignal): Promise<PlaceTerrain> {
    return loadLivePlace(lat, lon, widthKm, this.grid, fetchWithTimeout(signal));
  }
}
