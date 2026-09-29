// Hội An Floods: real Thu Bồn delta terrain; a storm swells the river until it spills into the Old Town unless the
// player raises a levee along the riverbank (or digs a relief channel to the sea).
import { DEFAULT_GRID } from '../core/types';
import { edges, type LevelDefinition } from './level-types';
import { placeUV } from './real-places';
import { findRealPlace } from './real-places-catalog';

const HOI_AN = findRealPlace('hoi-an');
if (!HOI_AN) throw new Error('Hội An is missing from the real-places catalogue');

/** The Old Town (Chùa Cầu / Trần Phú street) on the baked Hội An map. */
export const HOI_AN_OLD_TOWN = placeUV(HOI_AN, DEFAULT_GRID, 15.877, 108.328);

export const HOI_AN_FLOODS_LEVEL: LevelDefinition = {
  id: 'hoi-an-floods',
  name: 'Hội An Floods',
  // Landmarks, not compass points: phones may show the map turned.
  tagline:
    'Typhoon rain is swelling the Thu Bồn river, and the Old Town floods almost every autumn. Raise a levee along ' +
    'the dashed line, between the river and the Old Town, before the river spills over.',
  // Unused: the real terrain replaces it (projector mode keeps the sand's own terrain).
  recipe: { kind: 'flat', seed: 1 },
  place: { id: 'hoi-an' },
  villages: [{ ...HOI_AN_OLD_TOWN, radius: 0.03, name: 'Hội An Old Town' }],
  // The Thu Bồn flood wave enters from the western edge of the map.
  sources: [{ u: 0.021, v: 0.68, radius: 0.02, rate: 1 }],
  openEdges: edges({ north: true, east: true }),
  durationSec: 90,
  storm: [
    { t: 0, rain: 0.0005 },
    { t: 15, rain: 0.003 },
    { t: 55, rain: 0.003 },
    { t: 90, rain: 0.0005 },
  ],
  floodDepthThreshold: 0.5,
  floodSecondsToLose: 15,
  prefillSec: 15,
  startTool: 'raise',
  // The levee that saves the Old Town: along the river's north bank, just below the town.
  hint: { from: { u: 0.24, v: 0.57 }, to: { u: 0.42, v: 0.57 }, tool: 'raise' },
};
