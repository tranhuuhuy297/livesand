// Tool palette metadata and brush defaults tuned for the 256-cell grid (levels are balanced around these values).
import type { SculptTool } from '../input/sculpt-tools';
import { ICONS } from './hud-icons';

export interface ToolInfo {
  id: SculptTool;
  label: string;
  key: string;
  icon: string;
  hint: string;
}

export const TOOLS: readonly ToolInfo[] = [
  { id: 'raise', label: 'Raise', key: '1', icon: ICONS.raise, hint: 'Pile up sand: hills, dams and levees' },
  { id: 'lower', label: 'Dig', key: '2', icon: ICONS.lower, hint: 'Dig channels and lakes' },
  { id: 'smooth', label: 'Smooth', key: '3', icon: ICONS.smooth, hint: 'Soften bumps and ridges' },
  { id: 'flatten', label: 'Flatten', key: '4', icon: ICONS.flatten, hint: 'Level ground to the height where you start' },
  { id: 'rain', label: 'Rain', key: '5', icon: ICONS.rain, hint: 'Make it rain under the cursor' },
];

export const BRUSH_RADIUS_MIN = 3;
export const BRUSH_RADIUS_MAX = 36;
export const BRUSH_RADIUS_DEFAULT = 8;

/** World units/s at the brush centre (smooth: blend fraction/s toward the local average). */
export const TOOL_STRENGTH: Record<Exclude<SculptTool, 'rain'>, number> = {
  raise: 10,
  lower: 10,
  smooth: 4,
  flatten: 12,
};

export const SIM_SPEEDS = [1, 2, 4] as const;

export function clampBrushRadius(radius: number): number {
  if (!Number.isFinite(radius)) return BRUSH_RADIUS_DEFAULT;
  return Math.min(BRUSH_RADIUS_MAX, Math.max(BRUSH_RADIUS_MIN, Math.round(radius)));
}

export function toolForKey(key: string): SculptTool | null {
  return TOOLS.find((t) => t.key === key)?.id ?? null;
}
