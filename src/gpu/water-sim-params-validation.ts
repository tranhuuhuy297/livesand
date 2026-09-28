// WaterSimParams defaults/validation and input-field sanitising for WaterSimPipes (kept GPU-free for Node tests).
import type { EdgeFlags } from '../core/types';

export interface WaterSimParams {
  gravity: number; // default 9.81
  damping: number; // flux damping per step, default 0.995
  evaporationPerSec: number; // fraction/s, default 0.01
  dt: number; // seconds per step, default 0.05
  openEdges: EdgeFlags; // default all false (walls)
}

export const DEFAULT_WATER_SIM_PARAMS: Readonly<WaterSimParams> = Object.freeze({
  gravity: 9.81,
  damping: 0.995,
  evaporationPerSec: 0.01,
  dt: 0.05,
  openEdges: Object.freeze({ north: false, east: false, south: false, west: false }),
});

/** Applies `patch` over `base`, returning a fresh validated copy; throws RangeError on invalid values. */
export function mergeWaterSimParams(base: Readonly<WaterSimParams>, patch: Partial<WaterSimParams>): WaterSimParams {
  // Explicit `undefined` in a patch means "unchanged", not "invalid".
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<WaterSimParams>;
  const merged: WaterSimParams = { ...base, ...defined };
  const e = merged.openEdges;
  merged.openEdges = { north: !!e.north, east: !!e.east, south: !!e.south, west: !!e.west };
  const check = (name: keyof WaterSimParams, ok: boolean): void => {
    if (!ok) throw new RangeError(`WaterSimParams.${name} is invalid: ${String(merged[name])}`);
  };
  check('gravity', Number.isFinite(merged.gravity) && merged.gravity >= 0);
  check('damping', Number.isFinite(merged.damping) && merged.damping >= 0 && merged.damping <= 1);
  check('evaporationPerSec', Number.isFinite(merged.evaporationPerSec) && merged.evaporationPerSec >= 0);
  check('dt', Number.isFinite(merged.dt) && merged.dt > 0);
  return merged;
}

/** Returns `data` when every value is finite and >= min, else a cleaned copy (non-finite -> 0, below min -> min). */
export function sanitizeField(data: Float32Array, min: number): { clean: Float32Array; hadNonFinite: boolean } {
  let dirty = false;
  for (let i = 0; i < data.length && !dirty; i++) dirty = !Number.isFinite(data[i]) || data[i] < min;
  if (!dirty) return { clean: data, hadNonFinite: false };
  let hadNonFinite = false;
  const clean = Float32Array.from(data, (v) => {
    if (Number.isFinite(v)) return Math.max(v, min);
    hadNonFinite = true;
    return 0;
  });
  return { clean, hadNonFinite };
}
