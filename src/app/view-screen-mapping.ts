// Maps between canvas client pixels and grid coordinates for the top-down (2D) and orbit (3D) views.
import { gridToWorld, type GridSize, type Vec2 } from '../core/types';
import { pickHeightfield } from '../input/heightfield-ray-picker';
import type { OrbitCamera } from '../render/orbit-camera';
import type { ViewMode } from './app-url-params';

export interface ViewGeometry {
  grid: GridSize;
  view: ViewMode;
  /** Canvas client rect (CSS pixels). */
  rect: DOMRect;
  camera: OrbitCamera;
  verticalScale: number;
  heights: Float32Array;
  /** 2D map turned a quarter for portrait screens (west at the top, north on the right). */
  rotated?: boolean;
}

/** Grid point under a client pixel; in 3D the ray is intersected with the heightfield (null when it misses). */
export function screenToGrid(g: ViewGeometry, clientX: number, clientY: number): Vec2 | null {
  const { rect, grid } = g;
  if (rect.width <= 0 || rect.height <= 0) return null;
  const u = (clientX - rect.left) / rect.width;
  const v = (clientY - rect.top) / rect.height;
  if (g.view === '2d') {
    // Matches the top-down shader: pixel uv * grid - 0.5 is the cell-centre coordinate.
    const [gu, gv] = g.rotated ? [v, 1 - u] : [u, v];
    return { x: gu * grid.width - 0.5, y: gv * grid.height - 0.5 };
  }
  const ray = g.camera.rayFromScreen(u * 2 - 1, 1 - v * 2, rect.width / rect.height);
  return pickHeightfield(g.heights, grid, g.verticalScale, ray);
}

/** Client-pixel position of a grid point at height h, or null when it is behind the 3D camera. */
export function gridToScreen(g: ViewGeometry, viewProj: Float32Array | null, gx: number, gy: number, h: number): Vec2 | null {
  const { rect, grid } = g;
  if (g.view === '2d' || !viewProj) {
    const gu = (gx + 0.5) / grid.width;
    const gv = (gy + 0.5) / grid.height;
    const [u, v] = g.rotated ? [1 - gv, gu] : [gu, gv];
    return { x: rect.left + u * rect.width, y: rect.top + v * rect.height };
  }
  const [x, y, z] = gridToWorld(grid, gx, gy, h, g.verticalScale);
  const m = viewProj;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (w <= 1e-6) return null;
  const nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
  const ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
  return { x: rect.left + (nx * 0.5 + 0.5) * rect.width, y: rect.top + (0.5 - ny * 0.5) * rect.height };
}
