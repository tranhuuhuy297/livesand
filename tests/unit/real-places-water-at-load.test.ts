import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID } from '../../src/core/types';
import { PLACE_PREFILL_RAIN, PLACE_PREFILL_SEC } from '../../src/game/real-place-levels';
import { findRealPlace, loadBakedPlace, placeUV } from '../../src/game/real-places';
import { riverPrefillEmission } from '../../src/game/terrain-flow-routing';
import { REFERENCE_SIM_DEFAULTS, ReferenceWaterSim } from './level-flood-reference-sim';

const PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url));
const diskFetch = (async (input: RequestInfo | URL) => new Response(readFileSync(PUBLIC_DIR + String(input).slice(2)))) as typeof fetch;
const { width: W, height: H } = DEFAULT_GRID;

describe('water on real maps at load (CPU replica of the GPU water model)', () => {
  it('Mount St. Helens: rivers leave through the open edges while Spirit Lake keeps its water', async () => {
    const t = await loadBakedPlace('mount-st-helens', DEFAULT_GRID, diskFetch);
    expect(Object.values(t.openEdges).every(Boolean)).toBe(true);
    const sim = new ReferenceWaterSim(DEFAULT_GRID, t.heights, { ...REFERENCE_SIM_DEFAULTS, openEdges: t.openEdges });
    const prefill = riverPrefillEmission(t.heights, DEFAULT_GRID, PLACE_PREFILL_RAIN);
    const dt = REFERENCE_SIM_DEFAULTS.dt;
    for (let s = 0; s < PLACE_PREFILL_SEC / dt; s++) sim.step(prefill);
    const lake = placeUV(findRealPlace('mount-st-helens')!, DEFAULT_GRID, 46.277, -122.137);
    const probe = { x: lake.u * (W - 1), y: lake.v * (H - 1), radius: 5 };
    const filled = sim.maxDepth(probe);
    expect(filled).toBeGreaterThan(0.05);
    // Half a minute of free play later, with no rain: the rivers have drained away but the lake is still there.
    const dry = new Float32Array(W * H);
    for (let s = 0; s < 30 / dt; s++) sim.step(dry);
    expect(sim.drained).toBeGreaterThan(100);
    // Evaporation alone leaves ~74% after 30 s: nothing runs out of the lake.
    expect(sim.maxDepth(probe)).toBeGreaterThan(filled * 0.6);
  }, 60_000);
});
