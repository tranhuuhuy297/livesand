// Depth -> terrain calibration: ROI, flat-sand reference, height scaling, filtering knobs.
import { computeHomography } from './homography';
import type { GridSize, Quad } from './types';

export interface DepthCalibration {
  /** Sandbox corners in depth-image pixel coords (TL, TR, BR, BL) -> grid rect. */
  roiQuad: Quad;
  /** Per grid cell depth (m) of flat sand; null => use referencePlaneMeters. Cells <= 0 also fall back. */
  referenceDepth: Float32Array | null;
  /** Fallback flat-sand distance (m). */
  referencePlaneMeters: number;
  /** World units (cells) per meter of relief, e.g. grid.width / boxWidthMeters. */
  unitsPerMeter: number;
  /** Height clamp in world units. */
  minHeight: number;
  maxHeight: number;
  /** Pixels this far above maxHeight are a hand/object, not sand. */
  handMarginMeters: number;
  /** EMA factor 0..1 (fraction of new sample per frame). */
  smoothing: number;
  /** World units; smaller deltas are ignored (noise hysteresis). */
  changeThreshold: number;
}

// Typical tabletop sandbox (~1 m wide) with the phone ~1 m above the sand.
const DEFAULT_BOX_WIDTH_METERS = 1.0;
const DEFAULT_REFERENCE_PLANE_METERS = 1.0;
// Diggable depth / pile height of real sand boxes (meters of relief).
const DEFAULT_DIG_METERS = 0.12;
const DEFAULT_PILE_METERS = 0.2;

export function gridRectQuad(grid: GridSize): Quad {
  return [
    { x: 0, y: 0 },
    { x: grid.width, y: 0 },
    { x: grid.width, y: grid.height },
    { x: 0, y: grid.height },
  ];
}

export function cloneQuad(q: Quad): Quad {
  return [{ ...q[0] }, { ...q[1] }, { ...q[2] }, { ...q[3] }];
}

export function assertValidGrid(grid: GridSize): void {
  if (!grid || !Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width <= 0 || grid.height <= 0) {
    throw new RangeError(`Invalid grid size ${grid?.width}x${grid?.height}`);
  }
}

export function defaultDepthCalibration(grid: GridSize, depthWidth: number, depthHeight: number): DepthCalibration {
  assertValidGrid(grid);
  if (!(depthWidth > 0) || !(depthHeight > 0) || !Number.isFinite(depthWidth) || !Number.isFinite(depthHeight)) {
    throw new RangeError(`Invalid depth image size ${depthWidth}x${depthHeight}`);
  }
  const unitsPerMeter = grid.width / DEFAULT_BOX_WIDTH_METERS;
  return {
    roiQuad: [
      { x: 0, y: 0 },
      { x: depthWidth, y: 0 },
      { x: depthWidth, y: depthHeight },
      { x: 0, y: depthHeight },
    ],
    referenceDepth: null,
    referencePlaneMeters: DEFAULT_REFERENCE_PLANE_METERS,
    unitsPerMeter,
    minHeight: -DEFAULT_DIG_METERS * unitsPerMeter,
    maxHeight: DEFAULT_PILE_METERS * unitsPerMeter,
    handMarginMeters: 0.05,
    smoothing: 0.3,
    changeThreshold: 0.75,
  };
}

function finite(v: number, name: string): void {
  if (!Number.isFinite(v)) throw new RangeError(`Depth calibration ${name} must be a finite number (got ${v})`);
}

/** Throws a descriptive error if the calibration cannot be used with this grid. */
export function validateDepthCalibration(cal: DepthCalibration, grid: GridSize): void {
  computeHomography(gridRectQuad(grid), cal.roiQuad); // throws on degenerate ROI
  const ref = cal.referenceDepth;
  if (ref !== null && (!(ref instanceof Float32Array) || ref.length !== grid.width * grid.height)) {
    throw new RangeError(`Depth calibration referenceDepth must be a Float32Array of ${grid.width * grid.height} cells`);
  }
  finite(cal.referencePlaneMeters, 'referencePlaneMeters');
  finite(cal.unitsPerMeter, 'unitsPerMeter');
  finite(cal.minHeight, 'minHeight');
  finite(cal.maxHeight, 'maxHeight');
  finite(cal.handMarginMeters, 'handMarginMeters');
  finite(cal.smoothing, 'smoothing');
  finite(cal.changeThreshold, 'changeThreshold');
  if (cal.referencePlaneMeters <= 0) throw new RangeError('Depth calibration referencePlaneMeters must be > 0');
  if (cal.unitsPerMeter <= 0) throw new RangeError('Depth calibration unitsPerMeter must be > 0');
  if (cal.minHeight > cal.maxHeight) throw new RangeError('Depth calibration minHeight must be <= maxHeight');
  if (cal.handMarginMeters < 0) throw new RangeError('Depth calibration handMarginMeters must be >= 0');
  if (cal.smoothing < 0 || cal.smoothing > 1) throw new RangeError('Depth calibration smoothing must be within 0..1');
  if (cal.changeThreshold < 0) throw new RangeError('Depth calibration changeThreshold must be >= 0');
}
