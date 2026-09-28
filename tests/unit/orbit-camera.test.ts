import { describe, expect, it } from 'vitest';
import { OrbitCamera, ORBIT_MAX_PITCH, ORBIT_MIN_PITCH } from '../../src/render/orbit-camera';
import { DEFAULT_GRID } from '../../src/core/types';

type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function project(m: Float32Array, p: V3): V3 {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return [x / w, y / w, z / w];
}

function distanceToRay(origin: V3, dir: V3, p: V3): number {
  const v = sub(p, origin);
  const t = dot(v, dir);
  return len(sub(v, [dir[0] * t, dir[1] * t, dir[2] * t]));
}

describe('OrbitCamera', () => {
  it('starts above the sandbox looking at the target', () => {
    const cam = new OrbitCamera(DEFAULT_GRID);
    const eye = cam.eye();
    expect(eye[1]).toBeGreaterThan(cam.target[1]);
    expect(len(sub(eye, cam.target))).toBeCloseTo(cam.distance, 3);
  });

  it('casts the screen-centre ray from the eye towards the target', () => {
    const cam = new OrbitCamera(DEFAULT_GRID);
    const ray = cam.rayFromScreen(0, 0, 4 / 3);
    const expected = norm(sub(cam.target, cam.eye()));
    expect(ray.origin[0]).toBeCloseTo(cam.eye()[0], 4);
    expect(ray.origin[1]).toBeCloseTo(cam.eye()[1], 4);
    expect(ray.origin[2]).toBeCloseTo(cam.eye()[2], 4);
    expect(dot(ray.dir, expected)).toBeGreaterThan(0.99999);
    expect(len(ray.dir)).toBeCloseTo(1, 5);
  });

  it('projects the target to the NDC centre with WebGPU depth in (0, 1)', () => {
    const cam = new OrbitCamera(DEFAULT_GRID);
    const ndc = project(cam.viewProjection(16 / 9), cam.target);
    expect(ndc[0]).toBeCloseTo(0, 4);
    expect(ndc[1]).toBeCloseTo(0, 4);
    expect(ndc[2]).toBeGreaterThan(0);
    expect(ndc[2]).toBeLessThan(1);
  });

  it('round-trips off-centre points: ray through a projected point passes through it', () => {
    const cam = new OrbitCamera(DEFAULT_GRID);
    cam.rotate(0.7, -0.2);
    const aspect = 1.5;
    const point: V3 = [60, 12, -40];
    const ndc = project(cam.viewProjection(aspect), point);
    const ray = cam.rayFromScreen(ndc[0], ndc[1], aspect);
    expect(distanceToRay(ray.origin, ray.dir, point)).toBeLessThan(0.05);
    expect(dot(ray.dir, sub(point, ray.origin))).toBeGreaterThan(0);
  });

  it('screen-right rays point to the camera right and screen-up rays point higher', () => {
    const cam = new OrbitCamera(DEFAULT_GRID);
    const centre = cam.rayFromScreen(0, 0, 1);
    const right = cam.rayFromScreen(0.8, 0, 1);
    const up = cam.rayFromScreen(0, 0.8, 1);
    const camRight: V3 = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
    expect(dot(sub(right.dir, centre.dir), camRight)).toBeGreaterThan(0);
    expect(up.dir[1]).toBeGreaterThan(centre.dir[1]);
  });

  it('clamps pitch between 5 and 89 degrees', () => {
    const cam = new OrbitCamera(DEFAULT_GRID);
    cam.rotate(0, 10);
    expect(cam.pitch).toBeCloseTo(ORBIT_MAX_PITCH, 10);
    expect(ORBIT_MAX_PITCH).toBeCloseTo((89 * Math.PI) / 180, 10);
    cam.rotate(0, -10);
    expect(cam.pitch).toBeCloseTo(ORBIT_MIN_PITCH, 10);
    expect(ORBIT_MIN_PITCH).toBeCloseTo((5 * Math.PI) / 180, 10);
    expect(cam.eye()[1]).toBeGreaterThan(cam.target[1]);
  });

  it('rotates yaw freely around the target at constant distance', () => {
    const cam = new OrbitCamera(DEFAULT_GRID);
    const before = cam.eye();
    cam.rotate(Math.PI / 2, 0);
    const after = cam.eye();
    expect(len(sub(after, before))).toBeGreaterThan(1);
    expect(len(sub(after, cam.target))).toBeCloseTo(cam.distance, 3);
  });

  it('zooms multiplicatively and clamps distance', () => {
    const cam = new OrbitCamera(DEFAULT_GRID);
    const start = cam.distance;
    cam.zoom(0.5);
    expect(cam.distance).toBeCloseTo(start * 0.5, 6);
    cam.zoom(1e-6);
    expect(cam.distance).toBe(cam.minDistance);
    cam.zoom(1e9);
    expect(cam.distance).toBe(cam.maxDistance);
    expect(cam.minDistance).toBeGreaterThan(0);
    cam.zoom(Number.NaN);
    cam.zoom(-2);
    expect(cam.distance).toBe(cam.maxDistance);
  });

  it('ignores non-finite rotation input and tolerates a bad aspect ratio', () => {
    const cam = new OrbitCamera(DEFAULT_GRID);
    const { yaw, pitch } = cam;
    cam.rotate(Number.NaN, Number.POSITIVE_INFINITY);
    expect(cam.yaw).toBe(yaw);
    expect(cam.pitch).toBe(pitch);
    const vp = cam.viewProjection(0);
    expect(vp).toHaveLength(16);
    expect(Array.from(vp).every(Number.isFinite)).toBe(true);
  });
});
