import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID } from '../../src/core/types';
import { allowsLavaTool, getLevel, isFreePlay, LEVELS, peakEruptionRate, SANDBOX_LEVEL } from '../../src/game/level-definitions';
import { generateTerrain, layoutToCell } from '../../src/game/terrain-generators';
import { VOLCANO_FEATURES as VF } from '../../src/game/volcano-terrain-layout';
import { playLavaLevel } from './level-lava-playthrough-helpers';
import type { PlayerStroke } from './level-playthrough-helpers';

const { width: W, height: H } = DEFAULT_GRID;
const level = getLevel('mount-ember');
const at = (h: Float32Array, p: { u: number; v: number }) => h[Math.round(layoutToCell(p.v, H)) * W + Math.round(layoutToCell(p.u, W))];
// Rendered sea level of virtual mode: ground below it reads as sea.
const SEA = 0.6;

// A wall across the gully just below the fork, and the alternative: a trench through the sill beside it.
const WALL: PlayerStroke = { tool: 'raise', path: [{ u: 0.23, v: 0.5 }, { u: 0.37, v: 0.5 }], radius: 0.03, strength: 10, speed: 12, start: 3, passes: 3 };
const TRENCH: PlayerStroke = { tool: 'lower', path: [{ u: 0.31, v: 0.455 }, { u: 0.43, v: 0.465 }], radius: 0.028, strength: 10, speed: 12, start: 3, passes: 3 };

describe('Mount Ember level data', () => {
  it('follows Flash Flood with one village, an eruption and the lava tool', () => {
    const i = LEVELS.indexOf(level);
    expect(level.id).toBe('mount-ember');
    expect(LEVELS[i - 1].id).toBe('flash-flood');
    expect(level.recipe.kind).toBe('volcano');
    expect(level.villages).toHaveLength(1);
    expect(peakEruptionRate(level)).toBeGreaterThan(0);
    expect(allowsLavaTool(level)).toBe(true);
    expect(allowsLavaTool(getLevel('first-flood'))).toBe(false);
    expect(allowsLavaTool(SANDBOX_LEVEL) && isFreePlay(SANDBOX_LEVEL)).toBe(true);
    const ts = level.eruption!.keyframes.map((k) => k.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(level.eruption!.keyframes.at(-1)!.rate).toBe(0);
  });

  it('shapes a crater lake, a breached rim, a gully down to the village and a sea to the east', () => {
    const h = generateTerrain(DEFAULT_GRID, level.recipe);
    const crater = at(h, VF.crater);
    const rim = Math.max(at(h, { u: VF.crater.u, v: VF.crater.v - 0.06 }), at(h, { u: VF.crater.u + 0.045, v: VF.crater.v }));
    expect(rim - crater).toBeGreaterThan(2);
    // Downhill all the way from the breach to the village.
    const path = [VF.breach, VF.fork, { u: 0.314, v: 0.6 }, VF.village];
    for (let i = 1; i < path.length; i++) expect(at(h, path[i])).toBeLessThan(at(h, path[i - 1]));
    expect(at(h, VF.village)).toBeGreaterThan(SEA + 2);
    for (let y = 0; y < H; y++) expect(h[y * W + W - 1]).toBeLessThan(SEA);
    expect(at(h, VF.shore)).toBeLessThan(at(h, VF.seaChannel));
  });
});

describe('Mount Ember lava (CPU replica of the GPU lava model)', () => {
  it('doing nothing burns Emberton well before the eruption ends', () => {
    const result = playLavaLevel(level);
    expect(result.phase).toBe('lost');
    expect(result.summary.saved).toBe(0);
    expect(result.burnedAtSec[0]).not.toBeNull();
    expect(result.elapsedSec).toBeLessThan(level.durationSec * 0.7);
    expect(result.peakLava[0]).toBeGreaterThan(0.2);
  }, 60_000);

  it('a wall across the gully below the fork saves the village and the lava builds new land in the sea', () => {
    const result = playLavaLevel(level, [WALL]);
    expect(result.phase).toBe('won');
    expect(result.summary.stars).toBe(3);
    expect(result.peakLava[0]).toBeLessThan(0.05);
    const base = generateTerrain(DEFAULT_GRID, level.recipe);
    let newLand = 0;
    for (let i = 0; i < base.length; i++) if (base[i] < SEA && base[i] + result.rock[i] + result.lava[i] > SEA + 0.3) newLand++;
    expect(newLand).toBeGreaterThan(20);
  }, 60_000);

  it('a trench through the sill also saves the village', () => {
    const result = playLavaLevel(level, [TRENCH]);
    expect(result.phase).toBe('won');
    expect(result.peakLava[0]).toBeLessThan(0.05);
  }, 60_000);
});
