// Orbit camera around the sandbox for the 3D view; pure math so it is unit-testable in Node.
import { mat4 } from 'wgpu-matrix';
import type { GridSize, Ray } from '../core/types';

const DEG = Math.PI / 180;
export const ORBIT_MIN_PITCH = 5 * DEG;
export const ORBIT_MAX_PITCH = 89 * DEG;
export const ORBIT_FOV_Y = 45 * DEG;

type Vec3 = [number, number, number];

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function transformPoint(m: Float32Array, x: number, y: number, z: number): Vec3 {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

export class OrbitCamera {
  yaw: number;
  pitch: number;
  distance: number;
  target: [number, number, number];
  readonly minDistance: number;
  readonly maxDistance: number;
  private readonly span: number;

  constructor(grid: GridSize) {
    this.span = Math.max(grid.width, grid.height, 1);
    this.minDistance = this.span * 0.2;
    this.maxDistance = this.span * 4;
    // Three-quarter view from the south-east: shows relief, water and the box walls at once.
    this.yaw = 0.5;
    this.pitch = 42 * DEG;
    this.distance = this.span * 1.15;
    this.target = [0, 6, 6];
  }

  rotate(dxRadians: number, dyRadians: number): void {
    if (Number.isFinite(dxRadians)) this.yaw = (this.yaw + dxRadians) % (Math.PI * 2);
    if (Number.isFinite(dyRadians)) this.pitch = clamp(this.pitch + dyRadians, ORBIT_MIN_PITCH, ORBIT_MAX_PITCH);
  }

  zoom(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    this.distance = clamp(this.distance * factor, this.minDistance, this.maxDistance);
  }

  eye(): [number, number, number] {
    const pitch = clamp(this.pitch, ORBIT_MIN_PITCH, ORBIT_MAX_PITCH);
    const dist = clamp(this.distance, this.minDistance, this.maxDistance);
    const flat = Math.cos(pitch) * dist;
    return [
      this.target[0] + flat * Math.sin(this.yaw),
      this.target[1] + Math.sin(pitch) * dist,
      this.target[2] + flat * Math.cos(this.yaw),
    ];
  }

  /** Column-major perspective * view with WebGPU clip depth [0, 1]. */
  viewProjection(aspect: number): Float32Array {
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
    const dist = clamp(this.distance, this.minDistance, this.maxDistance);
    const near = Math.max(0.1, dist * 0.02);
    const far = dist + this.span * 3;
    const proj = mat4.perspective(ORBIT_FOV_Y, safeAspect, near, far);
    const view = mat4.lookAt(this.eye(), this.target, [0, 1, 0]);
    return mat4.multiply(proj, view) as Float32Array;
  }

  /** World-space ray from the eye through an NDC point (x right, y up, both in [-1, 1]). */
  rayFromScreen(ndcX: number, ndcY: number, aspect: number): Ray {
    const inv = mat4.inverse(this.viewProjection(aspect)) as Float32Array;
    const nearPt = transformPoint(inv, ndcX, ndcY, 0);
    const farPt = transformPoint(inv, ndcX, ndcY, 1);
    const d: Vec3 = [farPt[0] - nearPt[0], farPt[1] - nearPt[1], farPt[2] - nearPt[2]];
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    return { origin: this.eye(), dir: [d[0] / len, d[1] / len, d[2] / len] };
  }
}
