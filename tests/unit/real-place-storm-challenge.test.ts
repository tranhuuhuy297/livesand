import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID, type GridSize } from '../../src/core/types';
import { PLACE_PREFILL_RAIN, realPlaceFreePlayLevel, realPlaceStormLevel } from '../../src/game/real-place-levels';
import { stormTownSpot } from '../../src/game/real-place-storm-town';
import { flowAccumulation, riverPrefillEmission } from '../../src/game/terrain-flow-routing';
import { loadBakedPlace } from '../../src/game/real-places';
import { playLevel, type PlayerStroke } from './level-playthrough-helpers';

const PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url));
const diskFetch = (async (input: RequestInfo | URL) => new Response(readFileSync(PUBLIC_DIR + String(input).slice(2)))) as typeof fetch;
const GRID: GridSize = { width: 64, height: 48 };
const field = (fn: (x: number, y: number) => number) => Float32Array.from({ length: 64 * 48 }, (_, i) => fn(i % 64, Math.floor(i / 64)));
const edges = { north: true, east: true, south: true, west: true };

describe('real-place free play', () => {
  it('opens with a rain prefill so rivers and lakes already hold water', () => {
    const level = realPlaceFreePlayLevel({ id: 'hue' }, edges, 'Huế', 'blurb');
    expect(level.prefillSec).toBeGreaterThan(0);
    expect(level.prefillRain).toBe(PLACE_PREFILL_RAIN);
    expect(level.sources).toEqual([]);
  });
});

describe('storm challenge town', () => {
  it('accumulates flow downhill', () => {
    const acc = flowAccumulation(field((x) => 100 - x), GRID);
    expect(acc[10 * 64 + 63]).toBeGreaterThan(acc[10 * 64 + 1]);
    expect(acc[10 * 64]).toBe(1);
  });

  it('pours the rain of a catchment into its river, leaving the slopes dry', () => {
    // Slopes falling towards a river down the middle, which runs south.
    const valley = field((x, y) => Math.abs(x - 32) * 2 + (48 - y) * 0.5);
    const rain = 0.01;
    const out = riverPrefillEmission(valley, GRID, rain, 0.02);
    const total = out.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(rain * 64 * 48 * 0.99); // every sloping cell drains to the river
    for (let y = 0; y < 48; y++) expect(out[y * 64 + 10]).toBe(0);
    expect(out[40 * 64 + 32]).toBeGreaterThan(rain * 10);
    // Rain on a flat plain soaks in rather than spreading into a sheet of water.
    const flat = riverPrefillEmission(new Float32Array(64 * 48), GRID, rain);
    expect(flat.every((v) => v === 0)).toBe(true);
    // Across a flat (a lake surface) the river still runs on towards the map edge.
    const lake = field((x, y) => (x >= 20 && x < 44 ? 1 : Math.abs(x - 32) * 2) + (48 - y) * (x >= 20 && x < 44 ? 0 : 0.5));
    const through = riverPrefillEmission(lake, GRID, rain, 0.02);
    expect(through.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it('stands on the low floodplain beside the river, not in its channel or in the sea', () => {
    // A valley draining south with a river down its middle and flat floodplains either side, sea in the south-east.
    const valley = field((x, y) => {
      if (x > 44 && y > 36) return 0;
      const d = Math.abs(x - 32);
      return 3 + (48 - y) * 0.05 + (d < 2 ? -1.5 : d < 12 ? 0.2 + (d - 2) * 0.02 : 0.4 + (d - 12) * 1.5);
    });
    const { u, v } = stormTownSpot(valley, GRID, 2);
    const x = Math.round(u * 63);
    const y = Math.round(v * 47);
    expect(Math.abs(x - 32)).toBeGreaterThanOrEqual(4);
    expect(Math.abs(x - 32)).toBeLessThan(12);
    expect(valley[y * 64 + x]).toBeGreaterThan(2.4);
  });

  it('moves off the sea onto the nearest dry land when the map centre is water', () => {
    const bay = field((x) => (x < 48 ? 0 : 5 + x * 0.1));
    const { u } = stormTownSpot(bay, GRID, 2);
    expect(Math.round(u * 63)).toBeGreaterThanOrEqual(50);
  });
});

describe('storm challenge on the real Hội An map (CPU replica of the GPU water model)', () => {
  it('floods the idle town, and raising its ground keeps it dry', async () => {
    const t = await loadBakedPlace('hoi-an', DEFAULT_GRID, diskFetch);
    const spot = stormTownSpot(t.heights, DEFAULT_GRID, t.seaLevel);
    const level = realPlaceStormLevel(realPlaceFreePlayLevel({ id: 'hoi-an' }, t.openEdges, 'Hội An', ''), spot);
    expect(level).toMatchObject({ name: 'Storm over Hội An', villages: [{ name: 'Hội An' }], prefillSec: 0, startTool: 'lower' });
    const idle = playLevel(level, [], DEFAULT_GRID, t.heights);
    expect(idle.phase).toBe('lost');
    const raise: PlayerStroke = { tool: 'raise', path: [{ u: spot.u - 0.035, v: spot.v }, { u: spot.u + 0.035, v: spot.v }], radius: 0.03, strength: 10, speed: 8, start: 2, passes: 4 };
    const saved = playLevel(level, [raise], DEFAULT_GRID, t.heights);
    expect(saved.phase).toBe('won');
  }, 60_000);
});
