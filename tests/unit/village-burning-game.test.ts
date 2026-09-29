import { describe, expect, it } from 'vitest';
import type { GridSize } from '../../src/core/types';
import type { LevelDefinition } from '../../src/game/level-definitions';
import { DEFAULT_BURN_SECONDS_TO_LOSE, LAVA_BURN_DEPTH, VillageFloodGame } from '../../src/game/village-flood-game';

const GRID: GridSize = { width: 101, height: 51 };

function makeLevel(patch: Partial<LevelDefinition> = {}): LevelDefinition {
  const villages = ['A', 'B'].map((name, i) => ({ u: 0.3 + 0.4 * i, v: 0.5, radius: 0.05, name }));
  return {
    id: 'volcano-test', name: 'Test', tagline: 'test', recipe: { kind: 'flat', seed: 1 }, villages, sources: [],
    openEdges: { north: false, east: true, south: false, west: false },
    durationSec: 60, storm: [], floodDepthThreshold: 0.5, floodSecondsToLose: 10,
    ...patch,
  };
}

const f32 = (...d: number[]) => new Float32Array(d);
const DRY = f32(0, 0);

function run(game: VillageFloodGame, seconds: number, water: Float32Array | null, lava: Float32Array | null, step = 0.1): void {
  for (let t = 0; t < seconds - 1e-9; t += step) game.update(step, water, lava);
}

describe('VillageFloodGame with lava', () => {
  it('burns a village under molten lava within the burn time, marking it burning then lost to lava', () => {
    const game = new VillageFloodGame(makeLevel(), GRID);
    game.start();
    run(game, 1, DRY, f32(LAVA_BURN_DEPTH * 3, 0));
    expect(game.villages[0].state).toBe('burning');
    expect(game.markers()[0]).toMatchObject({ state: 'burning', flood01: expect.closeTo(1 / DEFAULT_BURN_SECONDS_TO_LOSE, 5) });
    expect(game.villages[1].state).toBe('safe');
    run(game, DEFAULT_BURN_SECONDS_TO_LOSE, DRY, f32(1, 0));
    expect(game.villages[0]).toMatchObject({ state: 'lost', lostTo: 'lava', burnedSec: DEFAULT_BURN_SECONDS_TO_LOSE });
    expect(game.markers()[0].flood01).toBe(1);
    expect(game.phase).toBe('running');
    run(game, 3, DRY, f32(0, 2));
    expect(game.phase).toBe('lost');
    expect(game.summary()).toEqual({ saved: 0, total: 2, stars: 0 });
  });

  it('ignores thin lava films and lets a doused fire die down', () => {
    const game = new VillageFloodGame(makeLevel({ burnSecondsToLose: 4 }), GRID);
    game.start();
    run(game, 5, DRY, f32(LAVA_BURN_DEPTH * 0.5, 0));
    expect(game.villages[0]).toMatchObject({ state: 'safe', burnedSec: 0 });
    run(game, 2, DRY, f32(1, 0));
    expect(game.villages[0].burnedSec).toBeCloseTo(2, 5);
    run(game, 2, DRY, null);
    expect(game.villages[0]).toMatchObject({ state: 'safe', lostTo: null });
    expect(game.villages[0].burnedSec).toBeCloseTo(1, 5);
  });

  it('keeps flooding and burning apart, with the flood loss attributed to water', () => {
    const game = new VillageFloodGame(makeLevel(), GRID);
    game.start();
    run(game, 10.5, f32(1, 0), null);
    expect(game.villages[0]).toMatchObject({ state: 'lost', lostTo: 'flood' });
    run(game, 1, f32(0, 1), f32(0, 1));
    expect(game.villages[1].state).toBe('burning');
  });

  it('freezes damage while neither readback has landed', () => {
    const game = new VillageFloodGame(makeLevel(), GRID);
    game.start();
    run(game, 1, DRY, f32(1, 0));
    run(game, 5, null, null);
    expect(game.villages[0]).toMatchObject({ state: 'burning', burnedSec: expect.closeTo(1, 5) });
    expect(game.elapsedSec).toBeCloseTo(6, 5);
  });

  it('reports the eruption rate on the level clock and resets burn state on a new attempt', () => {
    const keyframes = [{ t: 0, rate: 0.2 }, { t: 10, rate: 1 }, { t: 20, rate: 0 }];
    const game = new VillageFloodGame(makeLevel({ eruption: { u: 0.5, v: 0.2, radius: 0.02, keyframes } }), GRID);
    expect(game.currentLavaRate()).toBeCloseTo(0.2, 6);
    game.start();
    run(game, 5, DRY, f32(1, 0));
    expect(game.currentLavaRate()).toBeCloseTo(0.6, 5);
    run(game, 20, DRY, null);
    expect(game.currentLavaRate()).toBe(0);
    game.reset();
    expect(game.villages.every((v) => v.burnedSec === 0 && v.lostTo === null && v.state === 'safe')).toBe(true);
    expect(new VillageFloodGame(makeLevel(), GRID).currentLavaRate()).toBe(0);
  });
});
