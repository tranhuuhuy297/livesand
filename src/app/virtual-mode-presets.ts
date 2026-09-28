// Virtual-mode presentation defaults: render style for generated terrain, starting tool, 3D camera framing.
import type { GridSize } from '../core/types';
import type { LevelDefinition } from '../game/level-definitions';
import type { SculptTool } from '../input/sculpt-tools';
import type { OrbitCamera } from '../render/orbit-camera';
import type { RenderStyle } from '../render/shading-common-wgsl';

/**
 * Only ground within ~1 unit of sea level (0) reads as blue, so dry valleys never look like water; the top plateau
 * at `relief` falls between contour levels instead of on one.
 */
export function virtualRenderStyle(relief: number): Partial<RenderStyle> {
  return { minHeight: -relief * 0.3, maxHeight: relief, contourInterval: relief / 14.5, verticalScale: 1.5, showHillshade: true };
}

/** Levels are about digging; free play starts by building. */
export function defaultToolFor(level: LevelDefinition): SculptTool {
  return level.villages.length > 0 ? 'lower' : 'raise';
}

/** Pulls the default 3D camera back until the whole box fits, more so on narrow/portrait windows. */
export function fitOrbitCameraToWindow(camera: OrbitCamera, grid: GridSize): void {
  // The 3D canvas always fills the window (the 2D map is letterboxed), so frame for the window's aspect.
  const aspect = window.innerHeight > 0 ? window.innerWidth / window.innerHeight : 16 / 10;
  const span = Math.max(grid.width, grid.height);
  camera.zoom((span * Math.min(2.6, 1.3 * Math.max(1, 1.7 / aspect))) / camera.distance);
}
