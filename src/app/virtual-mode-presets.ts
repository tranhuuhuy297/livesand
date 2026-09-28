// Virtual-mode presentation defaults: render style for generated terrain, starting tool, 3D camera framing.
import type { GridSize } from '../core/types';
import type { LevelDefinition } from '../game/level-definitions';
import type { SculptTool } from '../input/sculpt-tools';
import type { OrbitCamera } from '../render/orbit-camera';
import type { RenderStyle } from '../render/shading-common-wgsl';

/** Water surface of the painted sea: ground dug down to (near) height 0 shows as sea water. */
export const VIRTUAL_SEA_LEVEL = 0.6;

/**
 * Only ground within ~1 unit of sea level (0) reads as blue, so dry valleys never look like water; the top plateau
 * at `relief` falls between contour levels instead of on one.
 */
export function virtualRenderStyle(relief: number): Partial<RenderStyle> {
  const contourInterval = relief / 14.5;
  return { minHeight: -relief * 0.3, maxHeight: relief, contourInterval, verticalScale: 1.5, showHillshade: true, seaLevel: VIRTUAL_SEA_LEVEL };
}

/** Levels are about digging; free play starts by building. */
export function defaultToolFor(level: LevelDefinition): SculptTool {
  return level.villages.length > 0 ? 'lower' : 'raise';
}

/** World-space height span of the 3D box: its floor (as drawn by the perspective renderer) to the top of the relief. */
export function boxHeightRange(style: Pick<RenderStyle, 'minHeight' | 'maxHeight' | 'verticalScale'>): { min: number; max: number } {
  const floor = style.minHeight - 0.12 * Math.max(style.maxHeight - style.minHeight, 1);
  return { min: floor * style.verticalScale, max: style.maxHeight * style.verticalScale };
}

/** Default orbit yaw (three-quarter view from the south-east). */
export const ORBIT_DEFAULT_YAW = 0.5;
const PORTRAIT_PITCH = (58 * Math.PI) / 180;

/** Screen area (NDC) the box should stay inside: clear of the top bar; the dock is small enough to overlap. */
function safeArea(aspect: number): { x: number; bottom: number; top: number } {
  // Phones in portrait stack two rows of top bar and a taller dock with village chips.
  return aspect < 1 ? { x: 0.96, bottom: -0.6, top: 0.7 } : { x: 0.94, bottom: -1.0, top: 0.8 };
}

/**
 * Frames the whole box for the window's aspect: portrait screens turn it a quarter so its long side runs up the
 * screen, then the camera backs off just far enough that every box corner (floor to top of relief) is on screen.
 */
export function fitOrbitCameraToWindow(camera: OrbitCamera, grid: GridSize, heightRange: { min: number; max: number }, aspect: number): void {
  // Portrait: nearly end-on and steeper, so the 256-cell axis spans the tall screen instead of running off its sides.
  camera.yaw = aspect < 1 ? Math.PI / 2 + 0.12 : ORBIT_DEFAULT_YAW;
  if (aspect < 1) camera.pitch = PORTRAIT_PITCH;
  const safe = safeArea(aspect);
  const corners: [number, number, number][] = [];
  for (const x of [-grid.width / 2, grid.width / 2]) {
    for (const z of [-grid.height / 2, grid.height / 2]) for (const y of [heightRange.min, heightRange.max]) corners.push([x, y, z]);
  }
  const fits = (distance: number): boolean => {
    camera.distance = distance;
    const m = camera.viewProjection(aspect);
    return corners.every(([x, y, z]) => {
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (w <= 1e-6) return false;
      const nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
      const ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
      return Math.abs(nx) <= safe.x && ny >= safe.bottom && ny <= safe.top;
    });
  };
  let lo = camera.minDistance;
  let hi = camera.maxDistance;
  if (!fits(hi)) return;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  camera.distance = hi;
}
