// Sky state a session feeds the renderers: storm strength (level storm or free-play rain) and volcanic ash.
import { isFreePlay, peakEruptionRate, peakStormRain, type LevelDefinition } from '../game/level-definitions';
import type { VillageFloodGame } from '../game/village-flood-game';

/** 0..1 storm strength for the rain visuals: the level storm relative to its peak, or the free-play rain toggle. */
export function stormLevelOf(level: LevelDefinition, game: VillageFloodGame, freeRain: boolean): number {
  if (isFreePlay(level)) return freeRain ? 1 : 0;
  const peak = peakStormRain(level);
  if (!(peak > 0) || game.phase !== 'running') return 0;
  return Math.min(1, Math.max(0, game.currentRainRate() / peak));
}

/** 0..1 ash in the sky while a volcano erupts: the crater's output relative to its peak. */
export function ashLevelOf(level: LevelDefinition, game: VillageFloodGame): number {
  const peak = peakEruptionRate(level);
  if (!(peak > 0) || game.phase !== 'running') return 0;
  return Math.min(1, Math.max(0, game.currentLavaRate() / peak));
}
