// LavaSimParams defaults/validation plus the fixed rheology constants shared by the lava shaders (GPU-free for Node tests).
import type { EdgeFlags } from '../core/types';

export interface LavaSimParams {
  gravity: number; // default 9.81
  damping: number; // flux damping per step; strong damping => viscous, slow flow (default 0.9)
  dt: number; // seconds per step, default 0.05
  coolingPerSec: number; // fraction of lava depth turning into rock per second (default 0.03)
  quenchPerSec: number; // extra cooling where lava touches water in its own or a neighbour cell (default 1)
  steamPerSec: number; // water depth removed per second per unit lava depth in contact (default 2)
  seaLevel: number; // ground (base + rock) below this is painted sea and quenches lava like water (default LAVA_NO_SEA)
  openEdges: EdgeFlags; // default all false (walls)
}

/** seaLevel of maps without a painted sea (matches the renderers' SEA_LEVEL_OFF). */
export const LAVA_NO_SEA = -1e6;

export const DEFAULT_LAVA_SIM_PARAMS: Readonly<LavaSimParams> = Object.freeze({
  gravity: 9.81,
  damping: 0.9,
  dt: 0.05,
  coolingPerSec: 0.03,
  quenchPerSec: 1,
  steamPerSec: 2,
  seaLevel: LAVA_NO_SEA,
  openEdges: Object.freeze({ north: false, east: false, south: false, west: false }),
});

/** Yield strength (world units²): a flow of depth d needs a head drop of LAVA_YIELD_STRENGTH / d per cell to move. */
export const LAVA_YIELD_STRENGTH = 0.1;

/** Lava thinner than this after cooling freezes outright, so flows end in finite time instead of glowing forever. */
export const LAVA_FREEZE_DEPTH = 0.005;

/** Water deeper than this in a cell or its neighbours quenches lava (thinner films just flash to steam). */
export const LAVA_WET_DEPTH = 0.05;

/** Applies `patch` over `base`, returning a fresh validated copy; throws RangeError on invalid values. */
export function mergeLavaSimParams(base: Readonly<LavaSimParams>, patch: Partial<LavaSimParams>): LavaSimParams {
  // Explicit `undefined` in a patch means "unchanged", not "invalid".
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<LavaSimParams>;
  const merged: LavaSimParams = { ...base, ...defined };
  const e = merged.openEdges;
  merged.openEdges = { north: !!e.north, east: !!e.east, south: !!e.south, west: !!e.west };
  const nonNegative = (v: number): boolean => Number.isFinite(v) && v >= 0;
  const check = (name: keyof LavaSimParams, ok: boolean): void => {
    if (!ok) throw new RangeError(`LavaSimParams.${name} is invalid: ${String(merged[name])}`);
  };
  check('gravity', nonNegative(merged.gravity));
  check('damping', nonNegative(merged.damping) && merged.damping <= 1);
  check('dt', Number.isFinite(merged.dt) && merged.dt > 0);
  check('coolingPerSec', nonNegative(merged.coolingPerSec));
  check('quenchPerSec', nonNegative(merged.quenchPerSec));
  check('steamPerSec', nonNegative(merged.steamPerSec));
  check('seaLevel', Number.isFinite(merged.seaLevel));
  return merged;
}
