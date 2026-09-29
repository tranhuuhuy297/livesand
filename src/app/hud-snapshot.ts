// Per-frame view model the virtual-mode HUD renders from, plus the actions it can trigger.
import type { VillageMarker } from '../core/types';
import { allowsLavaTool, LEVELS, type LevelDefinition } from '../game/level-definitions';
import type { GamePhase, VillageRuntime } from '../game/village-flood-game';
import type { ViewMode } from './app-url-params';
import type { SandboxSession } from './sandbox-session';
import type { AppTool } from './sculpt-tool-settings';
import type { PlaceInfo } from './virtual-level-flow';

export interface HudSnapshot {
  level: LevelDefinition;
  /** Index in LEVELS, or -1 for free play. */
  levelIndex: number;
  levelCount: number;
  phase: GamePhase;
  elapsedSec: number;
  rainRate: number;
  /** Crater emission of an eruption level right now (0 otherwise). */
  eruptionRate: number;
  villages: readonly VillageRuntime[];
  markers: readonly VillageMarker[];
  summary: { saved: number; total: number; stars: 0 | 1 | 2 | 3 };
  tool: AppTool;
  /** The lava tool is offered (free play and volcano levels). */
  lavaTool: boolean;
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
  /** Name of the map being downloaded, or null. */
  loading: string | null;
  /** Real terrain under the current level (credit + share link), or null for procedural terrain. */
  place: PlaceInfo | null;
  /** Real-place free play is open (or under its storm): "Flood it" and "back to the map" are available. */
  hasFreePlace: boolean;
  /** Real seconds since the attempt was won or lost (0 while it runs): the result card waits for the aftermath. */
  endedSec: number;
  /** Per village: molten lava is close (the "Lava close" warning). */
  lavaNear: readonly boolean[];
}

export interface HudActions {
  selectLevel(id: string): void;
  /** Free play on a catalogue place ('ha-long-bay'). */
  selectPlace(id: string): void;
  /** Free play on live terrain tiles around any coordinates, labelled `name` when known (search, reverse geocoding). */
  loadLivePlace(lat: number, lon: number, widthKm: number, name?: string | null): void;
  startLevel(): void;
  resetLevel(): void;
  nextLevel(): void;
  setTool(tool: AppTool): void;
  setBrushRadius(radius: number): void;
  setView(view: ViewMode): void;
  cycleSpeed(): void;
  toggleFullscreen(): void;
  openProjectorMode(): void;
  /** Free play: next landscape with a fresh seed. */
  newTerrain(): void;
  /** Free play: global rain on/off. */
  toggleRain(): void;
  /** Shares a link to the current level or place (system share sheet where there is one, else the clipboard). */
  shareLevel(): void;
  /** Real-place free play: a storm with the player's town near the map centre. */
  floodPlace(): void;
  /** After a level: free play on the same real place (after its storm), else the procedural free play. */
  leaveLevel(): void;
}

export interface HudUiState {
  tool: AppTool;
  brushRadius: number;
  view: ViewMode;
  speed: number;
  paused: boolean;
  sculpted: boolean;
  loading: string | null;
  place: PlaceInfo | null;
  hasFreePlace: boolean;
  endedSec: number;
}

export function buildHudSnapshot(session: SandboxSession, ui: HudUiState): HudSnapshot {
  const { game, level } = session;
  return {
    level,
    levelIndex: LEVELS.indexOf(level),
    levelCount: LEVELS.length,
    phase: game.phase,
    elapsedSec: game.elapsedSec,
    rainRate: game.currentRainRate(),
    eruptionRate: game.currentLavaRate(),
    villages: game.villages,
    markers: game.markers(),
    summary: game.summary(),
    lavaTool: allowsLavaTool(level),
    freeRain: session.freePlayRain,
    stormLevel: session.stormLevel,
    lavaNear: session.lavaNear,
    ...ui,
  };
}
