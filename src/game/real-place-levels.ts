// Levels on real terrain: free play on a catalogue place or any lat/lon (rain on demand, lava tool), and the "Flood it"
// storm challenge that pins the player's town near the map centre.
import type { EdgeFlags } from '../core/types';
import type { LevelDefinition, PlaceRef } from './level-types';
import type { RealPlace } from './real-places-catalog';

/** Seconds of rain simulated at load, so rivers and lakes already hold water on the first frame. */
export const PLACE_PREFILL_SEC = 15;
/** Prefill rain (units/s per cell), routed into the rivers: enough to light up the drainage network. */
export const PLACE_PREFILL_RAIN = 0.004;

/** Vietnamese places show their Vietnamese name ('Vịnh Hạ Long'), others their English one. */
export function placeDisplayName(place: RealPlace): string {
  return place.nameVi ?? place.name;
}

/** Picker/state id: 'place-<catalogue id>' or 'place-custom' for live coordinates. */
export function placeLevelId(ref: PlaceRef): string {
  return 'id' in ref ? `place-${ref.id}` : 'place-custom';
}

export function realPlaceFreePlayLevel(ref: PlaceRef, openEdges: EdgeFlags, name: string, tagline: string): LevelDefinition {
  return {
    id: placeLevelId(ref),
    name,
    tagline,
    // Unused: the downloaded terrain replaces it.
    recipe: { kind: 'flat', seed: 1 },
    place: ref,
    villages: [],
    sources: [],
    openEdges: { ...openEdges },
    durationSec: Infinity,
    storm: [],
    floodDepthThreshold: 0.5,
    floodSecondsToLose: 15,
    prefillSec: PLACE_PREFILL_SEC,
    prefillRain: PLACE_PREFILL_RAIN,
  };
}

/** "Flood it": a storm over the map with the player's town (see stormTownSpot); dig and build to keep it dry. */
export function realPlaceStormLevel(free: LevelDefinition, town: { u: number; v: number }): LevelDefinition {
  return {
    ...free,
    id: `${free.id}-storm`,
    name: `Storm over ${free.name}`,
    tagline: `A typhoon is heading for ${free.name}. Raise the town's ground, dig channels to drain the water or build levees to keep it dry until the storm passes.`,
    villages: [{ ...town, radius: 0.03, name: free.name }],
    durationSec: 60,
    storm: [
      { t: 0, rain: 0.001 },
      { t: 8, rain: 0.012 },
      { t: 42, rain: 0.012 },
      { t: 60, rain: 0.001 },
    ],
    floodSecondsToLose: 10,
    // Dry rivers at the start: the storm itself fills them, so the town never drowns before the player can act.
    prefillSec: 0,
    prefillRain: 0,
    startTool: 'lower',
  };
}
