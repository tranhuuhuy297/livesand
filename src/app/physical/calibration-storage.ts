// Versioned, validated persistence of the physical-mode calibration in localStorage.
import { validateDepthCalibration } from '../../core/depth-calibration';
import { MAX_DEPTH_SIDE } from '../../core/depth-frame-protocol';
import type { GridSize, Quad } from '../../core/types';
import { base64ToFloat32, float32ToBase64 } from './float32-base64-codec';
import { toDepthCalibration, type PhysicalCalibration } from './physical-calibration-model';
import { copyQuad, isUsableQuad, readQuad } from './quad-geometry';

export const CALIBRATION_STORAGE_KEY = 'livesand.physical-calibration';
export const CALIBRATION_FORMAT_VERSION = 1;

export type CalibrationStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type CalibrationLoadResult =
  | { ok: true; calibration: PhysicalCalibration }
  | { ok: false; missing: boolean; reason: string };

export class CalibrationFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalibrationFormatError';
  }
}

interface StoredCalibrationV1 {
  version: number;
  grid: GridSize;
  depthWidth: number;
  depthHeight: number;
  roiQuad: Quad;
  referenceDepthBase64: string | null;
  referencePlaneMeters: number;
  boxWidthCm: number;
  unitsPerMeter: number;
  minHeight: number;
  maxHeight: number;
  keystone: Quad;
  savedAt: number;
}

/** localStorage, or null where it is missing or blocked (privacy mode, sandboxed iframes throw on access). */
export function browserCalibrationStorage(): CalibrationStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function serializeCalibration(cal: PhysicalCalibration): string {
  const stored: StoredCalibrationV1 = {
    version: CALIBRATION_FORMAT_VERSION,
    grid: { width: cal.grid.width, height: cal.grid.height },
    depthWidth: cal.depthWidth,
    depthHeight: cal.depthHeight,
    roiQuad: copyQuad(cal.roiQuad),
    referenceDepthBase64: cal.referenceDepth ? float32ToBase64(cal.referenceDepth) : null,
    referencePlaneMeters: cal.referencePlaneMeters,
    boxWidthCm: cal.boxWidthCm,
    unitsPerMeter: cal.unitsPerMeter,
    minHeight: cal.minHeight,
    maxHeight: cal.maxHeight,
    keystone: copyQuad(cal.keystone),
    savedAt: cal.savedAt,
  };
  return JSON.stringify(stored);
}

function num(obj: Record<string, unknown>, key: string, check: (v: number) => boolean, rule: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || !check(v)) throw new CalibrationFormatError(`${key} must be ${rule}`);
  return v;
}

function quad(obj: Record<string, unknown>, key: string): Quad {
  const q = readQuad(obj[key]);
  if (!q || !isUsableQuad(q)) throw new CalibrationFormatError(`${key} must be 4 corners forming a convex quad`);
  return q;
}

function reference(obj: Record<string, unknown>, cells: number): Float32Array | null {
  const raw = obj.referenceDepthBase64;
  if (raw === null) return null;
  if (typeof raw !== 'string') throw new CalibrationFormatError('referenceDepthBase64 must be a string or null');
  let values: Float32Array;
  try {
    values = base64ToFloat32(raw);
  } catch (err) {
    throw new CalibrationFormatError(`referenceDepthBase64 is corrupt: ${(err as Error).message}`);
  }
  if (values.length !== cells) throw new CalibrationFormatError(`reference depth has ${values.length} cells, expected ${cells}`);
  if (!values.every((d) => Number.isFinite(d) && d >= 0)) throw new CalibrationFormatError('reference depth has invalid values');
  return values;
}

/** Parses and fully validates a stored calibration for `grid`; throws CalibrationFormatError with the reason. */
export function parseCalibration(json: string, grid: GridSize): PhysicalCalibration {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CalibrationFormatError('saved calibration is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new CalibrationFormatError('saved calibration is not an object');
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== CALIBRATION_FORMAT_VERSION) {
    throw new CalibrationFormatError(`saved calibration has format version ${String(obj.version)}, expected ${CALIBRATION_FORMAT_VERSION}`);
  }
  const g = obj.grid as Partial<GridSize> | undefined;
  if (!g || g.width !== grid.width || g.height !== grid.height) {
    throw new CalibrationFormatError(`saved calibration is for a ${g?.width}x${g?.height} grid, not ${grid.width}x${grid.height}`);
  }
  const side = (v: number) => Number.isInteger(v) && v > 0 && v <= MAX_DEPTH_SIDE;
  const cal: PhysicalCalibration = {
    grid: { width: grid.width, height: grid.height },
    depthWidth: num(obj, 'depthWidth', side, `an integer in 1..${MAX_DEPTH_SIDE}`),
    depthHeight: num(obj, 'depthHeight', side, `an integer in 1..${MAX_DEPTH_SIDE}`),
    roiQuad: quad(obj, 'roiQuad'),
    referenceDepth: reference(obj, grid.width * grid.height),
    referencePlaneMeters: num(obj, 'referencePlaneMeters', (v) => v > 0, 'a positive number'),
    boxWidthCm: num(obj, 'boxWidthCm', (v) => v > 0, 'a positive number'),
    unitsPerMeter: num(obj, 'unitsPerMeter', (v) => v > 0, 'a positive number'),
    minHeight: num(obj, 'minHeight', (v) => v <= 0, 'a number <= 0'),
    maxHeight: num(obj, 'maxHeight', (v) => v > 0, 'a number > 0'),
    keystone: quad(obj, 'keystone'),
    savedAt: num(obj, 'savedAt', (v) => v >= 0, 'a timestamp'),
  };
  try {
    validateDepthCalibration(toDepthCalibration(cal), grid);
  } catch (err) {
    throw new CalibrationFormatError(`saved calibration is unusable: ${(err as Error).message}`);
  }
  return cal;
}

export function loadCalibration(grid: GridSize, storage: CalibrationStorage | null = browserCalibrationStorage()): CalibrationLoadResult {
  if (!storage) return { ok: false, missing: true, reason: 'browser storage is unavailable' };
  let json: string | null;
  try {
    json = storage.getItem(CALIBRATION_STORAGE_KEY);
  } catch (err) {
    return { ok: false, missing: true, reason: `browser storage is unavailable: ${(err as Error).message}` };
  }
  if (json === null) return { ok: false, missing: true, reason: 'no saved calibration' };
  try {
    return { ok: true, calibration: parseCalibration(json, grid) };
  } catch (err) {
    return { ok: false, missing: false, reason: (err as Error).message };
  }
}

/** Throws a user-readable Error when the browser refuses to store it (quota, privacy mode). */
export function saveCalibration(cal: PhysicalCalibration, storage: CalibrationStorage | null = browserCalibrationStorage()): void {
  if (!storage) throw new Error('Browser storage is unavailable, so the calibration only lasts for this session');
  const json = serializeCalibration(cal);
  try {
    storage.setItem(CALIBRATION_STORAGE_KEY, json);
  } catch (err) {
    throw new Error(`The browser refused to save the calibration (${(err as Error).name || 'storage error'}); it only lasts for this session`);
  }
}

export function clearCalibration(storage: CalibrationStorage | null = browserCalibrationStorage()): void {
  try {
    storage?.removeItem(CALIBRATION_STORAGE_KEY);
  } catch {
    // Nothing stored can be read back either, so a failed removal is harmless.
  }
}
