// Mount Ember, the volcano level: idle play loses Emberton to the lava; a wall across the gully below the fork (or a
// trench through the sill beside it) turns the flow east into the sea, where it cools into new land.
import { edges, type LevelDefinition } from './level-types';
import { VOLCANO_FEATURES as VF } from './volcano-terrain-layout';

export const MOUNT_EMBER_LEVEL: LevelDefinition = {
  id: 'mount-ember',
  name: 'Mount Ember',
  // Landmarks, not compass points: phones turn the map a quarter, so "east" would point down the screen.
  tagline:
    'Mount Ember is waking up, and its lava will run down the gully into Emberton. Build a wall across the gully ' +
    'along the dashed line, just below the fork, and the lava will take the side channel into the sea instead.',
  recipe: { kind: 'volcano', seed: 4409 },
  villages: [{ ...VF.village, radius: 0.03, name: 'Emberton' }],
  sources: [],
  openEdges: edges({ east: true }),
  durationSec: 90,
  storm: [],
  floodDepthThreshold: 0.5,
  floodSecondsToLose: 15,
  // Rumble fills the crater, the eruption overflows it, then two smaller waves test the player's wall.
  eruption: {
    ...VF.crater,
    radius: 0.018,
    keyframes: [
      { t: 0, rate: 0.15 },
      { t: 6, rate: 0.15 },
      { t: 10, rate: 0.55 },
      { t: 32, rate: 0.55 },
      { t: 38, rate: 0.25 },
      { t: 44, rate: 0.55 },
      { t: 54, rate: 0.55 },
      { t: 60, rate: 0.25 },
      { t: 64, rate: 0.5 },
      { t: 72, rate: 0.5 },
      { t: 80, rate: 0 },
    ],
  },
  burnSecondsToLose: 3,
  startTool: 'raise',
  // The wall that saves Emberton: across the gully just below the fork.
  hint: { from: { u: 0.23, v: 0.5 }, to: { u: 0.37, v: 0.5 }, tool: 'raise' },
  lavaFlow: { damping: 0.985, coolingPerSec: 0.015 },
};
