// Shared render style + the WGSL library both renderers prepend to their entry points.
import { FRAME_BINDINGS_WGSL, SIM_SAMPLING_WGSL } from './sim-sampling-shaders';
import { TERRAIN_PALETTE_WGSL } from './terrain-palette-shaders';
import { WATER_SURFACE_WGSL } from './water-surface-shaders';
import { VILLAGE_MARKER_WGSL } from './village-marker-shaders';

export { FRAME_BINDINGS_WGSL, SIM_SAMPLING_WGSL, TERRAIN_PALETTE_WGSL, WATER_SURFACE_WGSL, VILLAGE_MARKER_WGSL };

export interface RenderStyle {
  minHeight: number;
  maxHeight: number;
  contourInterval: number;
  verticalScale: number;
  showHillshade: boolean;
  timeSec: number;
}

export const DEFAULT_RENDER_STYLE: RenderStyle = Object.freeze({
  minHeight: 0,
  maxHeight: 40,
  contourInterval: 2,
  verticalScale: 1.5,
  showHillshade: true,
  timeSec: 0,
});

/** Frame bindings, sim samplers, colormap/contours/hillshade, water shading and village markers in one module. */
export const SHADING_COMMON_WGSL = [
  FRAME_BINDINGS_WGSL,
  SIM_SAMPLING_WGSL,
  TERRAIN_PALETTE_WGSL,
  WATER_SURFACE_WGSL,
  VILLAGE_MARKER_WGSL,
].join('\n');

/** Merges a style patch, ignoring non-finite numbers so one bad slider value cannot blank the view. */
export function mergeRenderStyle(base: RenderStyle, patch: Partial<RenderStyle>): RenderStyle {
  const next: RenderStyle = { ...base };
  const numeric = ['minHeight', 'maxHeight', 'contourInterval', 'verticalScale', 'timeSec'] as const;
  for (const key of numeric) {
    const value = patch[key];
    if (typeof value === 'number' && Number.isFinite(value)) next[key] = value;
  }
  if (typeof patch.showHillshade === 'boolean') next.showHillshade = patch.showHillshade;
  next.contourInterval = Math.max(0, next.contourInterval);
  return next;
}
