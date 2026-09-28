// Camera gestures on the canvas: two-finger orbit + pinch zoom, and the mouse wheel (zoom in 3D, brush size in 2D).
import type { Vec2 } from '../core/types';
import type { OrbitCamera } from '../render/orbit-camera';

export interface PinchState {
  dist: number;
  mid: Vec2;
}

export const ORBIT_RADIANS_PER_PX = 0.006;

/** Distance and midpoint of the first two touches, or null with fewer than two. */
export function pinchState(pointers: ReadonlyMap<number, Vec2>): PinchState | null {
  const pts = [...pointers.values()];
  if (pts.length < 2) return null;
  const [a, b] = pts;
  return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}

/** Applies the change between two pinch states to the camera. */
export function applyPinchOrbit(camera: OrbitCamera, prev: PinchState, next: PinchState): void {
  camera.rotate(-(next.mid.x - prev.mid.x) * ORBIT_RADIANS_PER_PX, (next.mid.y - prev.mid.y) * ORBIT_RADIANS_PER_PX);
  if (prev.dist > 10 && next.dist > 10) camera.zoom(prev.dist / next.dist);
}

const WHEEL_ZOOM_PER_PX = 0.0015;

/** Wheel: Alt or the 2D view resizes the brush by one step, otherwise the 3D camera zooms. */
export function applyWheel(ev: WheelEvent, view: '2d' | '3d', camera: OrbitCamera, changeBrushRadius: (delta: number) => void): void {
  const scale = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
  const delta = ev.deltaY * scale;
  if (ev.altKey || view === '2d') {
    if (delta !== 0) changeBrushRadius(delta < 0 ? 1 : -1);
    return;
  }
  camera.zoom(Math.exp(Math.max(-200, Math.min(200, delta)) * WHEEL_ZOOM_PER_PX));
}
