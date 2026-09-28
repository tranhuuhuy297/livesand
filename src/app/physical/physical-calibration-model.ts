// Physical-mode calibration: what the wizard produces, what storage persists, and how it feeds the depth processor.
import { defaultDepthCalibration, type DepthCalibration } from '../../core/depth-terrain-processor';
import type { DepthFrame } from '../../core/depth-frame-protocol';
import type { GridSize, Quad } from '../../core/types';
import { copyQuad, rectQuad, unitSquareQuad } from './quad-geometry';

export interface PhysicalCalibration {
  grid: GridSize;
  depthWidth: number;
  depthHeight: number;
  /** Sandbox corners in depth-image pixels (TL, TR, BR, BL). */
  roiQuad: Quad;
  /** Flat-sand depth per grid cell (m); null => referencePlaneMeters everywhere. */
  referenceDepth: Float32Array | null;
  referencePlaneMeters: number;
  boxWidthCm: number;
  unitsPerMeter: number;
  /** Relief range in world units relative to flat sand (minHeight <= 0 < maxHeight). */
  minHeight: number;
  maxHeight: number;
  /** Projector corner-pin normalized to the projector surface size (TL, TR, BR, BL); unit square = no keystone. */
  keystone: Quad;
  savedAt: number;
}

export interface HeightRange {
  /** Deepest diggable level (always 0). */
  min: number;
  /** Highest pile. */
  max: number;
  /** Height of undisturbed flat sand. */
  flat: number;
}

export const DEFAULT_BOX_WIDTH_CM = 100;
export const DEFAULT_DIG_CM = 12;
export const DEFAULT_PILE_CM = 20;
// Sand is the farthest large surface under the sensor; piles, hands and the box rim are closer.
const ROUGH_PLANE_PERCENTILE = 0.9;

export function unitsPerMeterForBox(grid: GridSize, boxWidthCm: number): number {
  return grid.width / (boxWidthCm / 100);
}

export function identityKeystone(): Quad {
  return unitSquareQuad();
}

export function reliefToHeights(grid: GridSize, boxWidthCm: number, digCm: number, pileCm: number) {
  const unitsPerMeter = unitsPerMeterForBox(grid, boxWidthCm);
  return { unitsPerMeter, minHeight: (-digCm / 100) * unitsPerMeter, maxHeight: (pileCm / 100) * unitsPerMeter };
}

export function heightRangeOf(cal: PhysicalCalibration): HeightRange {
  return { min: 0, max: cal.maxHeight - cal.minHeight, flat: -cal.minHeight };
}

/** Height range the default relief produces, for use before any calibration exists. */
export function defaultHeightRange(grid: GridSize): HeightRange {
  const r = reliefToHeights(grid, DEFAULT_BOX_WIDTH_CM, DEFAULT_DIG_CM, DEFAULT_PILE_CM);
  return { min: 0, max: r.maxHeight - r.minHeight, flat: -r.minHeight };
}

/**
 * Processor calibration with the height datum moved down by the dig depth, so terrain handed to the simulation
 * is >= 0 (like the virtual terrains) and flat sand sits at `heightRangeOf(cal).flat`.
 */
export function toDepthCalibration(cal: PhysicalCalibration): DepthCalibration {
  const base = defaultDepthCalibration(cal.grid, cal.depthWidth, cal.depthHeight);
  const shiftMeters = -cal.minHeight / cal.unitsPerMeter;
  let referenceDepth: Float32Array | null = null;
  if (cal.referenceDepth) {
    referenceDepth = new Float32Array(cal.referenceDepth.length);
    for (let i = 0; i < referenceDepth.length; i++) {
      const d = cal.referenceDepth[i];
      referenceDepth[i] = d > 0 ? d + shiftMeters : 0; // 0 keeps "fall back to the plane" semantics
    }
  }
  return {
    ...base,
    roiQuad: copyQuad(cal.roiQuad),
    referenceDepth,
    referencePlaneMeters: cal.referencePlaneMeters + shiftMeters,
    unitsPerMeter: cal.unitsPerMeter,
    minHeight: 0,
    maxHeight: cal.maxHeight - cal.minHeight,
  };
}

/** Distance (m) of the flat-sand plane estimated from one frame; null if the frame has no valid depth. */
export function estimateSandPlaneMeters(frame: DepthFrame): number | null {
  const values: number[] = [];
  const stride = Math.max(1, Math.floor(frame.depthMeters.length / 8192));
  for (let i = 0; i < frame.depthMeters.length; i += stride) {
    const d = frame.depthMeters[i];
    if (d > 0) values.push(d);
  }
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.floor(values.length * ROUGH_PLANE_PERCENTILE))];
}

/** Whole-image ROI, estimated sand plane and default relief: usable terrain before the user calibrates. */
export function makeRoughCalibration(grid: GridSize, frame: DepthFrame, keystone: Quad): PhysicalCalibration | null {
  const plane = estimateSandPlaneMeters(frame);
  if (plane === null) return null;
  return {
    grid: { ...grid },
    depthWidth: frame.width,
    depthHeight: frame.height,
    roiQuad: rectQuad(frame.width, frame.height),
    referenceDepth: null,
    referencePlaneMeters: plane,
    boxWidthCm: DEFAULT_BOX_WIDTH_CM,
    ...reliefToHeights(grid, DEFAULT_BOX_WIDTH_CM, DEFAULT_DIG_CM, DEFAULT_PILE_CM),
    keystone: copyQuad(keystone),
    savedAt: 0,
  };
}
