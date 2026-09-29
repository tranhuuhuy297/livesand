import { describe, expect, it } from 'vitest';
import { eruptionCrater, LAVA_BRUSH_RATE, LAVA_IDLE_FRAMES, SessionLavaField } from '../../src/app/session-lava-field';
import { LevelTerrainSource } from '../../src/app/session-level-terrain';
import { getLevel } from '../../src/game/level-definitions';
import { generateTerrain } from '../../src/game/terrain-generators';
import { VillageFloodGame } from '../../src/game/village-flood-game';

const GRID = { width: 64, height: 48 };
const sum = (a: Float32Array) => a.reduce((s, v) => s + v, 0);

describe('SessionLavaField emission', () => {
  it('emits under the lava brush and at the crater, and re-uploads only when something changed', () => {
    const field = new SessionLavaField(GRID);
    expect(sum(field.update(1, null)!)).toBe(0);
    expect(field.update(1, null)).toBeNull();
    field.paintBrush(20, 20, 4);
    // The field buffer is reused between uploads, so sums are taken right away.
    const brushed = field.update(1, null)!;
    expect(brushed[20 * GRID.width + 20]).toBeCloseTo(LAVA_BRUSH_RATE, 5);
    const brushedSum = sum(brushed);
    expect(field.update(1, null)).toBeNull();
    const crater = { u: 0.5, v: 0.5, radius: 0.05, rate: 0.8 };
    expect(sum(field.update(1, crater)!)).toBeGreaterThan(brushedSum);
    field.clearBrush();
    const craterOnly = field.update(1, crater)!;
    expect(craterOnly[20 * GRID.width + 20]).toBe(0);
    expect(Math.max(...craterOnly)).toBeCloseTo(0.8, 5);
    expect(field.update(2, crater)).not.toBeNull();
  });

  it('eruptionCrater follows the level clock and is silent outside a running eruption', () => {
    const level = getLevel('mount-ember');
    const game = new VillageFloodGame(level, GRID);
    expect(eruptionCrater(level, game)).toBeNull();
    game.start();
    expect(eruptionCrater(level, game)).toMatchObject({ u: level.eruption!.u, v: level.eruption!.v, rate: game.currentLavaRate() });
    const flood = getLevel('first-flood');
    const floodGame = new VillageFloodGame(flood, GRID);
    floodGame.start();
    expect(eruptionCrater(flood, floodGame)).toBeNull();
  });
});

describe('SessionLavaField activity', () => {
  it('stays active while emitting, then stops after enough stepped frames without molten lava', () => {
    const field = new SessionLavaField(GRID);
    expect(field.active).toBe(false);
    field.paintBrush(10, 10, 3);
    field.update(1, null);
    expect(field.active).toBe(true);
    field.clearBrush();
    field.update(1, null);
    for (let i = 0; i < LAVA_IDLE_FRAMES * 2; i++) field.track(true, 0.4);
    expect(field.active).toBe(true);
    for (let i = 0; i < LAVA_IDLE_FRAMES - 1; i++) field.track(true, 0);
    // Frames without steps or without a readback prove nothing about the lava.
    field.track(false, 0);
    field.track(true, null);
    expect(field.active).toBe(true);
    field.track(true, 0);
    expect(field.active).toBe(false);
  });

  it('a lava reading resets the quiet count, and reset() forgets everything', () => {
    const field = new SessionLavaField(GRID);
    field.update(1, { u: 0.5, v: 0.5, radius: 0.05, rate: 1 });
    field.update(1, null);
    for (let i = 0; i < LAVA_IDLE_FRAMES - 1; i++) field.track(true, 0);
    field.track(true, 0.01);
    for (let i = 0; i < LAVA_IDLE_FRAMES - 1; i++) field.track(true, 0);
    expect(field.active).toBe(true);
    field.reset();
    expect(field.active).toBe(false);
    expect(field.update(1, null)).not.toBeNull();
  });
});

describe('LevelTerrainSource', () => {
  it('generates procedural levels and reuses real-place heights on restarts only', () => {
    const source = new LevelTerrainSource(GRID);
    const flood = getLevel('first-flood');
    expect(source.heightsFor(flood)).toEqual(generateTerrain(GRID, flood.recipe));
    const hoiAn = getLevel('hoi-an-floods');
    expect(() => source.heightsFor(hoiAn)).toThrow(/needs its map/);
    const real = new Float32Array(GRID.width * GRID.height).fill(3);
    expect(source.heightsFor(hoiAn, real)).toBe(real);
    real.fill(9);
    expect(source.heightsFor(hoiAn)[0]).toBe(3);
    expect(() => source.heightsFor(hoiAn, new Float32Array(5))).toThrow(RangeError);
  });
});
