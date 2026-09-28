import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID } from '../../src/core/types';
import {
  BLANK_SANDBOX_LEVEL,
  FREE_PLAY_LAND_COUNT,
  LEVELS,
  SANDBOX_LEVEL,
  freePlayLevel,
  getLevel,
  isFreePlay,
  type LevelDefinition,
} from '../../src/game/level-definitions';
import { generateTerrain, layoutToCell } from '../../src/game/terrain-generators';
import { playLevel, type PlayerStroke } from './level-playthrough-helpers';

const { width: W, height: H } = DEFAULT_GRID;
const heightAt = (h: Float32Array, u: number, v: number) => h[Math.round(layoutToCell(v, H)) * W + Math.round(layoutToCell(u, W))];

describe('level catalogue', () => {
  it('has at least three uniquely named levels with escalating village counts', () => {
    expect(LEVELS.length).toBeGreaterThanOrEqual(3);
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(LEVELS.length);
    const counts = LEVELS.map((l) => l.villages.length);
    expect(counts[0]).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
  });

  it.each(LEVELS.map((l) => [l.id, l] as const))('%s has sane rules and data', (_id, level: LevelDefinition) => {
    expect(level.name.length).toBeGreaterThan(0);
    expect(level.tagline.length).toBeGreaterThan(0);
    expect(Number.isFinite(level.durationSec) && level.durationSec > 0).toBe(true);
    expect(level.floodDepthThreshold).toBeGreaterThan(0);
    expect(level.floodSecondsToLose).toBeGreaterThan(0);
    expect(Object.values(level.openEdges).some(Boolean)).toBe(true);
    expect(level.sources.length + level.storm.length).toBeGreaterThan(0);
    level.storm.forEach((k, i) => {
      expect(k.rain).toBeGreaterThanOrEqual(0);
      if (i > 0) expect(k.t).toBeGreaterThan(level.storm[i - 1].t);
    });
  });

  it.each(LEVELS.map((l) => [l.id, l] as const))('%s keeps villages and sources inside the grid', (_id, level) => {
    for (const spot of [...level.villages, ...level.sources]) {
      const x = layoutToCell(spot.u, W);
      const y = layoutToCell(spot.v, H);
      const r = spot.radius * (W - 1);
      expect(r).toBeGreaterThan(0);
      expect(x - r).toBeGreaterThanOrEqual(0);
      expect(x + r).toBeLessThanOrEqual(W - 1);
      expect(y - r).toBeGreaterThanOrEqual(0);
      expect(y + r).toBeLessThanOrEqual(H - 1);
    }
  });

  it.each(LEVELS.map((l) => [l.id, l] as const))('%s puts every source on higher ground than every village', (_id, level) => {
    const h = generateTerrain(DEFAULT_GRID, level.recipe);
    for (const s of level.sources) {
      for (const v of level.villages) expect(heightAt(h, s.u, s.v)).toBeGreaterThan(heightAt(h, v.u, v.v) + 5);
    }
  });

  it('getLevel finds levels, free play, blank sand, and falls back to the first level', () => {
    for (const level of LEVELS) expect(getLevel(level.id)).toBe(level);
    expect(getLevel('sandbox')).toBe(SANDBOX_LEVEL);
    expect(getLevel('blank')).toBe(BLANK_SANDBOX_LEVEL);
    expect(getLevel('no-such-level')).toBe(LEVELS[0]);
    expect(getLevel('')).toBe(LEVELS[0]);
  });

  it('free play opens on a living landscape: terrain, a spring, a drain, water already flowing, no clock', () => {
    expect(isFreePlay(SANDBOX_LEVEL)).toBe(true);
    expect(SANDBOX_LEVEL.durationSec).toBe(Infinity);
    expect(SANDBOX_LEVEL.recipe.kind).not.toBe('flat');
    expect(SANDBOX_LEVEL.sources.length).toBeGreaterThan(0);
    expect(Object.values(SANDBOX_LEVEL.openEdges).some(Boolean)).toBe(true);
    expect(SANDBOX_LEVEL.prefillSec).toBeGreaterThan(0);
    expect(LEVELS).not.toContain(SANDBOX_LEVEL);
  });

  it('free-play landscapes cycle through every terrain kind with the given seed and keep the sandbox id', () => {
    const kinds = new Set(Array.from({ length: FREE_PLAY_LAND_COUNT }, (_, i) => freePlayLevel(i, 42).recipe.kind));
    expect(kinds.size).toBe(FREE_PLAY_LAND_COUNT);
    expect(freePlayLevel(FREE_PLAY_LAND_COUNT + 1, 7)).toMatchObject({ id: 'sandbox', recipe: { kind: freePlayLevel(1, 7).recipe.kind, seed: 7 } });
    expect(freePlayLevel(-1, 3).recipe.kind).toBe(freePlayLevel(FREE_PLAY_LAND_COUNT - 1, 3).recipe.kind);
    for (let i = 0; i < FREE_PLAY_LAND_COUNT; i++) {
      const level = freePlayLevel(i, 5);
      const h = generateTerrain(DEFAULT_GRID, level.recipe);
      for (const s of level.sources) expect(heightAt(h, s.u, s.v)).toBeGreaterThan(5);
    }
  });

  it('blank sand is a flat closed box without springs', () => {
    expect(isFreePlay(BLANK_SANDBOX_LEVEL)).toBe(true);
    expect(BLANK_SANDBOX_LEVEL.recipe.kind).toBe('flat');
    expect(BLANK_SANDBOX_LEVEL.sources).toHaveLength(0);
    expect(Object.values(BLANK_SANDBOX_LEVEL.openEdges).some(Boolean)).toBe(false);
    expect(BLANK_SANDBOX_LEVEL.prefillSec ?? 0).toBe(0);
  });
});

// Reference solutions a player could perform with default-ish brushes (radius ~8 cells, 8-12 units/s), started
// a few seconds after the briefing because the rivers already flow at that point.
const lower = (path: PlayerStroke['path'], start: number, passes = 1, strength = 8, speed = 12): PlayerStroke => ({ tool: 'lower', path, radius: 0.03, strength, speed, start, passes });
const levee = (path: PlayerStroke['path'], start: number): PlayerStroke => ({ tool: 'raise', path, radius: 0.025, strength: 12, speed: 10, start, passes: 2 });
const mound = (c: { u: number; v: number }, start: number): PlayerStroke => ({
  tool: 'raise',
  path: Array.from({ length: 9 }, (_, k) => ({ u: c.u + 0.005 * Math.cos((k / 8) * 2 * Math.PI), v: c.v + 0.006 * Math.sin((k / 8) * 2 * Math.PI) })),
  radius: 0.05, strength: 8, speed: 5, start, passes: 1,
});

const SOLUTIONS: Record<string, PlayerStroke[]> = {
  // Drain the lake beside Millbrook east through the coastal bank.
  'first-flood': [lower([{ u: 0.5, v: 0.76 }, { u: 0.86, v: 0.76 }], 4)],
  // Levee each side arm just below its fork.
  'twin-towns': [levee([{ u: 0.2, v: 0.37 }, { u: 0.2, v: 0.46 }], 5), levee([{ u: 0.8, v: 0.52 }, { u: 0.8, v: 0.62 }], 10)],
  // Dig the canyon out to the sea, then raise each village above the rising lake.
  'flash-flood': [
    lower([{ u: 0.5, v: 0.5 }, { u: 0.5, v: 0.6 }, { u: 0.53, v: 0.8 }, { u: 0.5, v: 0.99 }], 8, 3, 10, 15),
    ...getLevel('flash-flood').villages.map((v, i) => mound(v, 30 + 5 * i)),
  ],
};

describe('level hydrology (CPU replica of the GPU water model)', () => {
  it.each(LEVELS.map((l) => [l.id, l] as const))('%s: doing nothing floods every village before time runs out', (_id, level) => {
    const result = playLevel(level);
    expect(result.phase).toBe('lost');
    expect(result.summary.saved).toBe(0);
    expect(result.elapsedSec).toBeLessThan(level.durationSec * 0.8);
    // Water keeps rising well past the threshold: the loss is not a knife-edge.
    for (const d of result.peakDepths) expect(d).toBeGreaterThan(level.floodDepthThreshold * 1.5);
  }, 60_000);

  it.each(LEVELS.map((l) => [l.id, l] as const))('%s: the intended earthworks save every village', (_id, level) => {
    const strokes = SOLUTIONS[level.id];
    expect(strokes).toBeDefined();
    const result = playLevel(level, strokes);
    expect(result.phase).toBe('won');
    expect(result.summary).toEqual({ saved: level.villages.length, total: level.villages.length, stars: 3 });
  }, 60_000);

  it.each([12, 48, 96])('first-flood: one %i cells/s swipe from the village straight to the sea saves Millbrook', (speed) => {
    const level = getLevel('first-flood');
    // The obvious first move: default Dig brush (8 cells, 10 units/s), village -> sea, a single pass.
    const swipe: PlayerStroke = { tool: 'lower', path: [{ u: 0.43, v: 0.73 }, { u: 0.9, v: 0.73 }], radius: 8 / 255, strength: 10, speed, start: 3, passes: 1 };
    const result = playLevel(level, [swipe]);
    expect(result.phase).toBe('won');
    expect(result.summary.stars).toBe(3);
  }, 60_000);
});
