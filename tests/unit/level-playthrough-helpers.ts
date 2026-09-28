// Scripted playthroughs: reference water sim + real emission field + game rules + sculpt tools, like the app loop.
import { DEFAULT_GRID, type GridSize } from '../../src/core/types';
import type { LevelDefinition } from '../../src/game/level-definitions';
import { defaultRelief, generateTerrain, layoutToCell } from '../../src/game/terrain-generators';
import { VillageFloodGame, buildEmissionField, type GamePhase } from '../../src/game/village-flood-game';
import { applySculptBrush, type SculptTool } from '../../src/input/sculpt-tools';
import { REFERENCE_SIM_DEFAULTS, ReferenceWaterSim } from './level-flood-reference-sim';

/** A player dragging a brush along a path (layout coords) back and forth, starting at `start` seconds. */
export interface PlayerStroke {
  tool: Exclude<SculptTool, 'rain'>;
  path: { u: number; v: number }[];
  /** Brush radius as a fraction of grid width. */
  radius: number;
  strength: number;
  /** Drag speed in cells/s. */
  speed: number;
  start: number;
  passes: number;
}

export interface PlaythroughResult {
  phase: GamePhase;
  elapsedSec: number;
  summary: ReturnType<VillageFloodGame['summary']>;
  lostAtSec: (number | null)[];
  peakDepths: number[];
}

/** Brush centre in grid cells at time t, or null when the stroke is not active. */
export function brushPosition(stroke: PlayerStroke, grid: GridSize, t: number): { x: number; y: number } | null {
  const pts = stroke.path.map((p) => ({ x: layoutToCell(p.u, grid.width), y: layoutToCell(p.v, grid.height) }));
  const segs = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  const len = segs.reduce((a, b) => a + b, 0);
  const travelled = (t - stroke.start) * stroke.speed;
  if (len <= 0 || travelled < 0 || travelled > len * stroke.passes) return null;
  const pass = Math.floor(travelled / len);
  let d = travelled - pass * len;
  if (pass % 2 === 1) d = len - d;
  let k = 0;
  while (k < segs.length - 1 && d > segs[k]) d -= segs[k++];
  const f = segs[k] > 0 ? Math.min(1, d / segs[k]) : 0;
  return { x: pts[k].x + (pts[k + 1].x - pts[k].x) * f, y: pts[k].y + (pts[k + 1].y - pts[k].y) * f };
}

/** Plays a level to the end (or until lost), applying the strokes once per simulation step. */
export function playLevel(level: LevelDefinition, strokes: PlayerStroke[] = [], grid: GridSize = DEFAULT_GRID): PlaythroughResult {
  const heights = generateTerrain(grid, level.recipe);
  const bounds = { min: 0, max: defaultRelief(grid) };
  const sim = new ReferenceWaterSim(grid, heights, { ...REFERENCE_SIM_DEFAULTS, openEdges: level.openEdges });
  const game = new VillageFloodGame(level, grid);
  const probes = game.probes();
  const emission = new Float32Array(grid.width * grid.height);
  const depths = new Float32Array(probes.length);
  const lostAtSec: (number | null)[] = probes.map(() => null);
  const peakDepths = probes.map(() => 0);
  const dt = sim.params.dt;
  const maxSteps = Math.ceil(level.durationSec / dt) + 10;
  game.start();
  for (let step = 0; step < maxSteps && game.phase === 'running'; step++) {
    const t = step * dt;
    for (const stroke of strokes) {
      const at = brushPosition(stroke, grid, t);
      if (at) {
        const brush = { radius: stroke.radius * (grid.width - 1), strength: stroke.strength };
        applySculptBrush(heights, grid, at.x, at.y, stroke.tool, brush, dt, bounds);
      }
    }
    buildEmissionField(grid, level.sources, game.currentRainRate(), null, null, 0, emission);
    sim.step(emission);
    probes.forEach((p, i) => {
      depths[i] = sim.maxDepth(p);
      peakDepths[i] = Math.max(peakDepths[i], depths[i]);
    });
    game.update(dt, depths);
    game.villages.forEach((v, i) => {
      if (v.state === 'lost' && lostAtSec[i] === null) lostAtSec[i] = game.elapsedSec;
    });
  }
  return { phase: game.phase, elapsedSec: game.elapsedSec, summary: game.summary(), lostAtSec, peakDepths };
}
