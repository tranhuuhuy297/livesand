// Scripted volcano playthroughs: reference lava sim + crater emission + game rules + sculpt tools, like the app loop.
import { DEFAULT_GRID, type GridSize } from '../../src/core/types';
import type { LevelDefinition } from '../../src/game/level-definitions';
import { defaultRelief, generateTerrain } from '../../src/game/terrain-generators';
import { VillageFloodGame, buildEmissionField, type GamePhase } from '../../src/game/village-flood-game';
import { buildVillageSculptFloor } from '../../src/game/village-sculpt-floor';
import { applySculptStroke } from '../../src/input/sculpt-tools';
import { brushPosition, type PlayerStroke } from './level-playthrough-helpers';
import { REFERENCE_LAVA_DEFAULTS, ReferenceLavaSim } from './level-lava-reference-sim';
import { VIRTUAL_SEA_LEVEL } from '../../src/app/virtual-mode-presets';

export interface LavaPlaythroughResult {
  phase: GamePhase;
  elapsedSec: number;
  summary: ReturnType<VillageFloodGame['summary']>;
  burnedAtSec: (number | null)[];
  peakLava: number[];
  heights: Float32Array;
  lava: Float32Array;
  rock: Float32Array;
}

/** Plays an eruption level to the end (or until lost); strokes are applied once per simulation step. */
export function playLavaLevel(level: LevelDefinition, strokes: PlayerStroke[] = [], grid: GridSize = DEFAULT_GRID): LavaPlaythroughResult {
  const eruption = level.eruption;
  if (!eruption) throw new Error(`${level.id} has no eruption`);
  const heights = generateTerrain(grid, level.recipe);
  // Mount Ember's painted sea (virtual mode's sea level) quenches lava like the GPU model.
  const sim = new ReferenceLavaSim(grid, heights, { ...REFERENCE_LAVA_DEFAULTS, ...level.lavaFlow, seaLevel: VIRTUAL_SEA_LEVEL, openEdges: level.openEdges });
  const game = new VillageFloodGame(level, grid);
  const bounds = { min: 0, max: defaultRelief(grid), floor: buildVillageSculptFloor(heights, grid, game.villages) };
  const probes = game.probes();
  const emission = new Float32Array(grid.width * grid.height);
  const dry = new Float32Array(probes.length);
  const lavaDepths = new Float32Array(probes.length);
  const burnedAtSec: (number | null)[] = probes.map(() => null);
  const peakLava = probes.map(() => 0);
  const dt = sim.params.dt;
  const last: ({ x: number; y: number } | null)[] = strokes.map(() => null);
  game.start();
  for (let step = 0; step < Math.ceil(level.durationSec / dt) + 10 && game.phase === 'running'; step++) {
    const t = step * dt;
    strokes.forEach((stroke, k) => {
      const at = brushPosition(stroke, grid, t);
      if (at) applySculptStroke(heights, grid, last[k], at, stroke.tool, { radius: stroke.radius * (grid.width - 1), strength: stroke.strength }, dt, bounds);
      last[k] = at;
    });
    buildEmissionField(grid, [{ ...eruption, rate: game.currentLavaRate() }], 0, null, null, 0, emission);
    sim.step(emission);
    probes.forEach((p, i) => {
      lavaDepths[i] = sim.maxDepth(p);
      peakLava[i] = Math.max(peakLava[i], lavaDepths[i]);
    });
    game.update(dt, dry, lavaDepths);
    game.villages.forEach((v, i) => {
      if (v.state === 'lost' && burnedAtSec[i] === null) burnedAtSec[i] = game.elapsedSec;
    });
  }
  return { phase: game.phase, elapsedSec: game.elapsedSec, summary: game.summary(), burnedAtSec, peakLava, heights, lava: sim.lava, rock: sim.rock };
}
