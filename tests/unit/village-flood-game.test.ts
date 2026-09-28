import { describe, expect, it } from 'vitest';
import type { GridSize } from '../../src/core/types';
import { SANDBOX_LEVEL, type LevelDefinition } from '../../src/game/level-definitions';
import { MAX_UPDATE_DT_SEC, VillageFloodGame, buildEmissionField, stormRainAt } from '../../src/game/village-flood-game';

const GRID: GridSize = { width: 101, height: 51 };

function makeLevel(patch: Partial<LevelDefinition> = {}): LevelDefinition {
  const villages = ['A', 'B', 'C'].map((name, i) => ({ u: 0.2 + 0.3 * i, v: 0.5, radius: 0.05, name }));
  return {
    id: 'test', name: 'Test', tagline: 'test level', recipe: { kind: 'flat', seed: 1 }, villages, sources: [],
    openEdges: { north: false, east: true, south: false, west: false },
    durationSec: 60, storm: [], floodDepthThreshold: 0.5, floodSecondsToLose: 10,
    ...patch,
  };
}

const depths = (...d: number[]) => new Float32Array(d);
const DRY = depths(0, 0, 0);

/** Advances in small steps so the dt clamp never interferes. */
function run(game: VillageFloodGame, seconds: number, d: Float32Array | null, step = 0.1): void {
  for (let t = 0; t < seconds - 1e-9; t += step) game.update(step, d);
}

describe('VillageFloodGame', () => {
  it('maps villages to grid coords and starts ready', () => {
    const game = new VillageFloodGame(makeLevel(), GRID);
    expect(game.phase).toBe('ready');
    expect(game.elapsedSec).toBe(0);
    expect(game.villages.map((v) => [v.x, v.y, v.radius])).toEqual([[20, 25, 5], [50, 25, 5], [80, 25, 5]]);
    expect(game.probes()).toEqual([{ x: 20, y: 25, radius: 5 }, { x: 50, y: 25, radius: 5 }, { x: 80, y: 25, radius: 5 }]);
    expect(game.markers().every((m) => m.state === 'safe' && m.flood01 === 0)).toBe(true);
    game.update(0.5, depths(9, 9, 9)); // ignored until started
    expect(game.elapsedSec).toBe(0);
    expect(game.villages[0].floodedSec).toBe(0);
  });

  it('accumulates flooding above the threshold and recovers at half speed when dry', () => {
    const game = new VillageFloodGame(makeLevel(), GRID);
    game.start();
    run(game, 4, depths(0.8, 0.5, 0));
    expect(game.villages[0].state).toBe('flooding');
    expect(game.villages[0].floodedSec).toBeCloseTo(4);
    expect(game.villages[1].state).toBe('safe'); // exactly at the threshold is not flooding
    expect(game.markers()[0]).toMatchObject({ state: 'flooding', flood01: expect.closeTo(0.4, 5) });
    run(game, 2, DRY);
    expect(game.villages[0].state).toBe('safe');
    expect(game.villages[0].floodedSec).toBeCloseTo(3);
    run(game, 20, DRY);
    expect(game.villages[0].floodedSec).toBe(0);
  });

  it('loses a village permanently and the game when all are lost', () => {
    const game = new VillageFloodGame(makeLevel(), GRID);
    game.start();
    run(game, 10.2, depths(2, 0, 0));
    expect(game.villages[0].state).toBe('lost');
    expect(game.markers()[0].flood01).toBe(1);
    run(game, 5, DRY);
    expect(game.villages[0].state).toBe('lost');
    expect(game.phase).toBe('running');
    run(game, 10.5, depths(0, 2, 2));
    expect(game.phase).toBe('lost');
    expect(game.summary()).toEqual({ saved: 0, total: 3, stars: 0 });
    const t = game.elapsedSec;
    game.update(1, DRY);
    expect(game.elapsedSec).toBe(t);
  });

  it('wins at the end of the timer when a village survives, with stars by survivors', () => {
    const cases: [Float32Array, 0 | 1 | 2 | 3][] = [[DRY, 3], [depths(2, 0, 0), 2], [depths(2, 2, 0), 1]];
    for (const [d, stars] of cases) {
      const game = new VillageFloodGame(makeLevel({ durationSec: 20 }), GRID);
      game.start();
      run(game, 12, d);
      run(game, 9, DRY);
      expect(game.phase).toBe('won');
      expect(game.elapsedSec).toBe(20);
      expect(game.summary().stars).toBe(stars);
    }
  });

  it('gives one star when one of two villages survives', () => {
    const game = new VillageFloodGame(makeLevel({ villages: makeLevel().villages.slice(0, 2), durationSec: 15 }), GRID);
    game.start();
    run(game, 16, depths(3, 0));
    expect(game.phase).toBe('won');
    expect(game.summary()).toEqual({ saved: 1, total: 2, stars: 1 });
  });

  it('freezes flood state without readback but keeps the clock running', () => {
    const game = new VillageFloodGame(makeLevel(), GRID);
    game.start();
    run(game, 3, depths(1, 1, 1));
    run(game, 3, null);
    expect(game.elapsedSec).toBeCloseTo(6);
    expect(game.villages[0].floodedSec).toBeCloseTo(3);
    expect(game.villages[0].state).toBe('flooding');
  });

  it('clamps huge frame gaps and ignores invalid dt', () => {
    const game = new VillageFloodGame(makeLevel(), GRID);
    game.start();
    game.update(30, depths(5, 5, 5));
    expect(game.elapsedSec).toBe(MAX_UPDATE_DT_SEC);
    expect(game.phase).toBe('running');
    for (const bad of [-1, 0, Number.NaN, Infinity]) game.update(bad, depths(5, 5, 5));
    expect(game.elapsedSec).toBe(MAX_UPDATE_DT_SEC);
  });

  it('reset returns to ready; start after a finished game begins a fresh attempt', () => {
    const game = new VillageFloodGame(makeLevel({ durationSec: 2 }), GRID);
    game.start();
    run(game, 3, depths(1, 0, 0));
    expect(game.phase).toBe('won');
    game.start();
    expect(game.phase).toBe('running');
    expect(game.elapsedSec).toBe(0);
    expect(game.villages[0].floodedSec).toBe(0);
    run(game, 1, depths(1, 0, 0));
    game.reset();
    expect(game.phase).toBe('ready');
    expect(game.villages.every((v) => v.state === 'safe' && v.floodedSec === 0)).toBe(true);
  });

  it('never ends in the sandbox', () => {
    const game = new VillageFloodGame(SANDBOX_LEVEL, GRID);
    game.start();
    for (let i = 0; i < 5000; i++) game.update(1, new Float32Array(0));
    expect(game.phase).toBe('running');
    expect(game.elapsedSec).toBe(5000);
    expect(game.markers()).toEqual([]);
    expect(game.summary()).toEqual({ saved: 0, total: 0, stars: 0 });
    expect(game.currentRainRate()).toBe(0);
  });

  it('follows the storm curve (linear, held at the ends, sorted)', () => {
    const storm = [{ t: 20, rain: 0 }, { t: 0, rain: 0.2 }, { t: 10, rain: 1 }];
    expect(stormRainAt([], 5)).toBe(0);
    expect(stormRainAt([{ t: 5, rain: 0.3 }], 0)).toBe(0.3);
    const game = new VillageFloodGame(makeLevel({ storm, durationSec: 100 }), GRID);
    expect(game.currentRainRate()).toBeCloseTo(0.2);
    game.start();
    run(game, 5, DRY);
    expect(game.currentRainRate()).toBeCloseTo(0.6);
    run(game, 10, DRY);
    expect(game.currentRainRate()).toBeCloseTo(0.5);
    run(game, 30, DRY);
    expect(game.currentRainRate()).toBe(0);
  });
});

describe('buildEmissionField', () => {
  const n = GRID.width * GRID.height;

  it('fills global rain and stamps sources as disks of rate', () => {
    const f = buildEmissionField(GRID, [{ u: 0.5, v: 0.5, radius: 0.03, rate: 2 }], 0.1, null, null, 0);
    expect(f.length).toBe(n);
    expect(f[0]).toBeCloseTo(0.1);
    expect(f[25 * GRID.width + 50]).toBeCloseTo(2.1);
    const covered = Array.from(f).filter((v) => v > 1).length;
    expect(covered).toBeGreaterThan(Math.PI * 9 * 0.8);
    expect(covered).toBeLessThan(Math.PI * 9 * 1.3);
  });

  it('adds brush rain and hand rain, ignoring invalid rates', () => {
    const brush = new Float32Array(n);
    brush[7] = 0.5;
    brush[8] = -3;
    const hand = new Uint8Array(n);
    hand[9] = 1;
    const f = buildEmissionField(GRID, [{ u: 0, v: 0, radius: 0, rate: Number.NaN }], -1, brush, hand, 0.25);
    expect(f[7]).toBeCloseTo(0.5);
    expect(f[8]).toBe(0);
    expect(f[9]).toBeCloseTo(0.25);
    expect(f[0]).toBe(0);
    expect(buildEmissionField(GRID, [], 0, null, hand, Number.NaN)[9]).toBe(0);
  });

  it('always covers at least the nearest cell for tiny sources and reuses `out`', () => {
    const out = new Float32Array(n).fill(99);
    const f = buildEmissionField(GRID, [{ u: 1, v: 1, radius: 0, rate: 3 }], 0, null, null, 0, out);
    expect(f).toBe(out);
    expect(f[n - 1]).toBe(3);
    expect(Array.from(f).filter((v) => v > 0).length).toBe(1);
  });

  it('rejects mismatched buffers', () => {
    expect(() => buildEmissionField(GRID, [], 0, new Float32Array(3), null, 0)).toThrow(RangeError);
    expect(() => buildEmissionField(GRID, [], 0, null, new Uint8Array(3), 1)).toThrow(RangeError);
    expect(() => buildEmissionField(GRID, [], 0, null, null, 0, new Float32Array(3))).toThrow(RangeError);
  });
});
