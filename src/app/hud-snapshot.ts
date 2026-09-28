// Per-frame view model the virtual-mode HUD renders from, plus the actions it can trigger.
import type { VillageMarker } from '../core/types';
import { LEVELS, type LevelDefinition } from '../game/level-definitions';
import type { GamePhase, VillageRuntime } from '../game/village-flood-game';
import type { SculptTool } from '../input/sculpt-tools';
import type { ViewMode } from './app-url-params';
import type { SandboxSession } from './sandbox-session';

export interface HudSnapshot {
  level: LevelDefinition;
  /** Index in LEVELS, or -1 for free play. */
  levelIndex: number;
  levelCount: number;
  phase: GamePhase;
  elapsedSec: number;
  rainRate: number;
  villages: readonly VillageRuntime[];
  markers: readonly VillageMarker[];
  summary: { saved: number; total: number; stars: 0 | 1 | 2 | 3 };
  tool: SculptTool;
  brushRadius: number;
  view: ViewMode;
  speed: number;
  /** A help/info dialog or the level menu is open, so the level clock and the water are on hold. */
  paused: boolean;
  /** The player has sculpted during this attempt (changes the advice after a loss). */
  sculpted: boolean;
  /** Free play: global rain toggle. */
  freeRain: boolean;
  /** 0..1 storm strength driving the rain overlay. */
  stormLevel: number;
}

export interface HudActions {
  selectLevel(id: string): void;
  startLevel(): void;
  resetLevel(): void;
  nextLevel(): void;
  setTool(tool: SculptTool): void;
  setBrushRadius(radius: number): void;
  setView(view: ViewMode): void;
  cycleSpeed(): void;
  toggleFullscreen(): void;
  openProjectorMode(): void;
  /** Free play: next landscape with a fresh seed. */
  newTerrain(): void;
  /** Free play: global rain on/off. */
  toggleRain(): void;
  /** Copies a link to the current level. */
  shareLevel(): void;
}

export function buildHudSnapshot(
  session: SandboxSession,
  ui: { tool: SculptTool; brushRadius: number; view: ViewMode; speed: number; paused: boolean; sculpted: boolean },
): HudSnapshot {
  const { game, level } = session;
  return {
    level,
    levelIndex: LEVELS.indexOf(level),
    levelCount: LEVELS.length,
    phase: game.phase,
    elapsedSec: game.elapsedSec,
    rainRate: game.currentRainRate(),
    villages: game.villages,
    markers: game.markers(),
    summary: game.summary(),
    freeRain: session.freePlayRain,
    stormLevel: session.stormLevel,
    ...ui,
  };
}
