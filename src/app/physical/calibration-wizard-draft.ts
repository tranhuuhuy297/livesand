// Creates the wizard's working draft (seeded from a previous calibration) and turns it into a PhysicalCalibration.
import type { GridSize, Quad } from '../../core/types';
import type { WizardDraft } from './calibration-wizard-types';
import {
  DEFAULT_BOX_WIDTH_CM, DEFAULT_DIG_CM, DEFAULT_PILE_CM, identityKeystone, reliefToHeights, type PhysicalCalibration,
} from './physical-calibration-model';
import { copyQuad, isUsableQuad } from './quad-geometry';

function roundCm(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Previous corners and reference are only reusable when the depth image size is unchanged. */
export function createWizardDraft(
  depthWidth: number, depthHeight: number, initial: PhysicalCalibration | null, keystone: Quad | null,
): WizardDraft {
  const draft: WizardDraft = {
    depthWidth,
    depthHeight,
    roiCorners: [null, null, null, null],
    referenceDepth: null,
    referencePlaneMeters: null,
    referenceStats: null,
    boxWidthCm: DEFAULT_BOX_WIDTH_CM,
    digCm: DEFAULT_DIG_CM,
    pileCm: DEFAULT_PILE_CM,
    keystone: copyQuad(initial?.keystone ?? keystone ?? identityKeystone()),
  };
  if (!initial) return draft;
  draft.boxWidthCm = roundCm(initial.boxWidthCm);
  draft.digCm = roundCm((-initial.minHeight / initial.unitsPerMeter) * 100);
  draft.pileCm = roundCm((initial.maxHeight / initial.unitsPerMeter) * 100);
  if (initial.depthWidth === depthWidth && initial.depthHeight === depthHeight) {
    draft.roiCorners = copyQuad(initial.roiQuad);
    draft.referenceDepth = initial.referenceDepth ? initial.referenceDepth.slice() : null;
    draft.referencePlaneMeters = initial.referencePlaneMeters;
  }
  return draft;
}

export function draftRoiQuad(draft: WizardDraft): Quad | null {
  const [a, b, c, d] = draft.roiCorners;
  if (!a || !b || !c || !d) return null;
  const q: Quad = [{ ...a }, { ...b }, { ...c }, { ...d }];
  return isUsableQuad(q) ? q : null;
}

/** Null until the corners form a valid quad and the flat sand has been captured. */
export function buildCalibrationFromDraft(grid: GridSize, draft: WizardDraft): PhysicalCalibration | null {
  const roi = draftRoiQuad(draft);
  if (!roi || draft.referencePlaneMeters === null) return null;
  return {
    grid: { width: grid.width, height: grid.height },
    depthWidth: draft.depthWidth,
    depthHeight: draft.depthHeight,
    roiQuad: roi,
    referenceDepth: draft.referenceDepth,
    referencePlaneMeters: draft.referencePlaneMeters,
    boxWidthCm: draft.boxWidthCm,
    ...reliefToHeights(grid, draft.boxWidthCm, draft.digCm, draft.pileCm),
    keystone: copyQuad(draft.keystone),
    savedAt: 0,
  };
}
