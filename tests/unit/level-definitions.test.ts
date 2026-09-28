import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID } from '../../src/core/types';
import { LEVELS, SANDBOX_LEVEL, getLevel, type LevelDefinition } from '../../src/game/level-definitions';
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

  it('getLevel finds levels, the sandbox, and falls back to the first level', () => {
    for (const level of LEVELS) expect(getLevel(level.id)).toBe(level);
    expect(getLevel('sandbox')).toBe(SANDBOX_LEVEL);
    expect(getLevel('no-such-level')).toBe(LEVELS[0]);
    expect(getLevel('')).toBe(LEVELS[0]);
  });

  it('sandbox is free play: no villages, no timer, flat box', () => {
    expect(SANDBOX_LEVEL.villages).toHaveLength(0);
    expect(SANDBOX_LEVEL.durationSec).toBe(Infinity);
    expect(SANDBOX_LEVEL.recipe.kind).toBe('flat');
    expect(LEVELS).not.toContain(SANDBOX_LEVEL);
  });
});

// Reference solutions a player could perform with default-ish brushes (radius ~8 cells, 8-12 units/s).
const lower = (path: PlayerStroke['path'], start: number, passes = 1, strength = 8, speed = 12): PlayerStroke => ({ tool: 'lower', path, radius: 0.03, strength, speed, start, passes });
const levee = (path: PlayerStroke['path'], start: number): PlayerStroke => ({ tool: 'raise', path, radius: 0.025, strength: 12, speed: 10, start, passes: 2 });
const mound = (c: { u: number; v: number }, start: number): PlayerStroke => ({
  tool: 'raise',
  path: Array.from({ length: 9 }, (_, k) => ({ u: c.u + 0.005 * Math.cos((k / 8) * 2 * Math.PI), v: c.v + 0.006 * Math.sin((k / 8) * 2 * Math.PI) })),
  radius: 0.05, strength: 8, speed: 5, start, passes: 1,
});

const SOLUTIONS: Record<string, PlayerStroke[]> = {
  // Drain the lake beside Millbrook east through the coastal bank.
  'first-flood': [lower([{ u: 0.5, v: 0.76 }, { u: 0.86, v: 0.76 }], 10)],
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
});
