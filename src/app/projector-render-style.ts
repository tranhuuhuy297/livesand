// Projector colormap range and contour spacing from the physical controller's calibration (defaults when none).
import type { GridSize } from '../core/types';
import type { RenderStyle } from '../render/shading-common-wgsl';
import type { PhysicalModeController } from './physical/physical-mode-controller';

// About one contour line per centimetre of sand, like classic AR sandboxes.
const CONTOUR_METERS = 0.01;

/**
 * Contour spacing near `nominal` that puts flat sand halfway between two lines; otherwise depth noise on
 * undisturbed sand would scribble contours over the whole box.
 */
export function contourIntervalAvoiding(flat: number, nominal: number): number {
  if (!(nominal > 0) || !(flat > nominal)) return nominal;
  return flat / (Math.max(0, Math.round(flat / nominal - 0.5)) + 0.5);
}

/** Physical heights start at 0 (deepest dig), so the colormap spans the controller's [0, max] range. */
export function projectorRenderStyle(physical: PhysicalModeController, grid: GridSize): Partial<RenderStyle> {
  const { max, flat } = physical.heightRange;
  const maxHeight = Number.isFinite(max) && max > 0 ? max : grid.width * 0.32;
  // Uncalibrated terrain uses the default 1 m wide box, i.e. grid.width units per metre.
  const unitsPerMeter = physical.calibration?.unitsPerMeter ?? grid.width;
  const nominal = Number.isFinite(unitsPerMeter) && unitsPerMeter > 0 ? unitsPerMeter * CONTOUR_METERS : maxHeight / 30;
  const contourInterval = contourIntervalAvoiding(Number.isFinite(flat) ? flat : 0, nominal);
  // Real sand casts its own shadows, so projected hillshade would only double them.
  return { minHeight: 0, maxHeight, contourInterval, showHillshade: false };
}
