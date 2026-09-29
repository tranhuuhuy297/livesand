import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_GRID } from '../../src/core/types';
import { HOI_AN_OLD_TOWN } from '../../src/game/hoi-an-floods-level';
import { getLevel, LEVELS } from '../../src/game/level-definitions';
import { loadBakedPlace, type PlaceTerrain } from '../../src/game/real-places';
import { layoutToCell } from '../../src/game/terrain-generators';
import { playLevel, type PlayerStroke } from './level-playthrough-helpers';

const PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url));
const diskFetch = (async (input: RequestInfo | URL) => new Response(readFileSync(PUBLIC_DIR + String(input).slice(2)))) as typeof fetch;
const { width: W, height: H } = DEFAULT_GRID;
const level = getLevel('hoi-an-floods');
// A levee along the north bank of the Thu Bồn, between the river and the Old Town.
const LEVEE: PlayerStroke = { tool: 'raise', path: [level.hint!.from, level.hint!.to], radius: 0.025, strength: 12, speed: 10, start: 5, passes: 2 };

let terrain: PlaceTerrain;
beforeAll(async () => {
  terrain = await loadBakedPlace('hoi-an', DEFAULT_GRID, diskFetch);
});

describe('Hội An Floods level data', () => {
  it('comes after Mount Ember on the real Hội An map, with open edges matching the coast', () => {
    expect(LEVELS[LEVELS.indexOf(level) - 1].id).toBe('mount-ember');
    expect(level.startTool).toBe('raise');
    expect(level.hint?.tool).toBe('raise');
    expect(level.place).toEqual({ id: 'hoi-an' });
    expect(level.openEdges).toEqual(terrain.openEdges);
    expect(level.storm.length).toBeGreaterThan(1);
  });

  it('puts the Old Town on dry land north of the river, where the real town is', () => {
    expect(HOI_AN_OLD_TOWN.u).toBeGreaterThan(0.25);
    expect(HOI_AN_OLD_TOWN.u).toBeLessThan(0.45);
    expect(HOI_AN_OLD_TOWN.v).toBeGreaterThan(0.45);
    expect(HOI_AN_OLD_TOWN.v).toBeLessThan(0.6);
    const [village] = level.villages;
    const x = Math.round(layoutToCell(village.u, W));
    const y = Math.round(layoutToCell(village.v, H));
    expect(terrain.heights[y * W + x]).toBeGreaterThan(terrain.seaLevel + 1);
    // The river (sea-level channel) runs a short way south of the town.
    const river = Array.from({ length: 30 }, (_, k) => terrain.heights[(y + k) * W + x]);
    expect(river.some((h) => h < terrain.seaLevel)).toBe(true);
  });
});

describe('Hội An Floods hydrology (CPU replica of the GPU water model)', () => {
  it('doing nothing floods the Old Town before the storm ends', () => {
    const result = playLevel(level, [], DEFAULT_GRID, terrain.heights);
    expect(result.phase).toBe('lost');
    expect(result.elapsedSec).toBeLessThan(level.durationSec * 0.8);
    expect(result.peakDepths[0]).toBeGreaterThan(level.floodDepthThreshold * 1.2);
  }, 60_000);

  it('a levee along the riverbank keeps the Old Town dry', () => {
    const result = playLevel(level, [LEVEE], DEFAULT_GRID, terrain.heights);
    expect(result.phase).toBe('won');
    expect(result.summary.stars).toBe(3);
    expect(result.peakDepths[0]).toBeLessThan(level.floodDepthThreshold * 0.6);
  }, 60_000);
});
