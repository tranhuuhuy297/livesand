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
}

/** Highest storm rain of a level (0 when it has no storm), used to scale the storm meter. */
export function peakStormRain(level: LevelDefinition): number {
  return level.storm.reduce((max, k) => Math.max(max, k.rain), 0);
}

export function buildHudSnapshot(
  session: SandboxSession,
  ui: { tool: SculptTool; brushRadius: number; view: ViewMode; speed: number },
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
    ...ui,
  };
}
