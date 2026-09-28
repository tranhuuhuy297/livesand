import { describe, expect, it } from 'vitest';
import { SessionEmissionField } from '../../src/app/session-emission-field';
import { boxHeightRange, fitOrbitCameraToWindow, ORBIT_DEFAULT_YAW } from '../../src/app/virtual-mode-presets';
import { DEFAULT_GRID } from '../../src/core/types';
import { sourceMarkers } from '../../src/game/emission-field';
import { getLevel } from '../../src/game/level-definitions';
import { layoutToCell } from '../../src/game/terrain-generators';
import { OrbitCamera } from '../../src/render/orbit-camera';
import { FRAME_UNIFORM_FLOATS, MAX_SOURCES, packFrameUniforms, SHADER_TIME_WRAP_SEC } from '../../src/render/render-frame-uniforms';
import { DEFAULT_RENDER_STYLE, SEA_LEVEL_OFF, mergeRenderStyle } from '../../src/render/shading-common-wgsl';

const EFFECTS = 52;
const MISC_TIME = 45;
const SOURCES = 56 + 16 * 4 * 2;

describe('packFrameUniforms', () => {
  const pack = (style = DEFAULT_RENDER_STYLE, sources: { x: number; y: number; radius: number }[] = [], rotated = false) =>
    packFrameUniforms(new Float32Array(FRAME_UNIFORM_FLOATS), DEFAULT_GRID, style, [], null, { sources, rotated });

  it('wraps shader time so f32 animation stays precise on all-day exhibits', () => {
    const t = SHADER_TIME_WRAP_SEC * 72 + 12.25; // a day in
    expect(pack({ ...DEFAULT_RENDER_STYLE, timeSec: t })[MISC_TIME]).toBeCloseTo(12.25, 4);
    expect(pack({ ...DEFAULT_RENDER_STYLE, timeSec: 3.5 })[MISC_TIME]).toBeCloseTo(3.5, 5);
    expect(pack({ ...DEFAULT_RENDER_STYLE, timeSec: -1 })[MISC_TIME]).toBeCloseTo(SHADER_TIME_WRAP_SEC - 1, 3);
  });

  it('packs sea level, clamped storm, spring count and the 2D quarter turn, then the springs', () => {
    const style = { ...DEFAULT_RENDER_STYLE, seaLevel: 0.6, stormLevel: 3 };
    const springs = Array.from({ length: MAX_SOURCES + 3 }, (_, i) => ({ x: i, y: 2 * i, radius: 4 }));
    const out = pack(style, springs, true);
    expect(Array.from(out.subarray(EFFECTS, EFFECTS + 4))).toEqual([Math.fround(0.6), 1, MAX_SOURCES, 1]);
    expect(Array.from(out.subarray(SOURCES + 4, SOURCES + 7))).toEqual([1, 2, 4]);
    expect(out[SOURCES + MAX_SOURCES * 4 - 4]).toBe(MAX_SOURCES - 1);
    expect(SOURCES + MAX_SOURCES * 4).toBe(FRAME_UNIFORM_FLOATS);
    expect(pack()[EFFECTS]).toBe(SEA_LEVEL_OFF);
  });

  it('merges sea and storm like the other numeric style fields', () => {
    const merged = mergeRenderStyle(DEFAULT_RENDER_STYLE, { seaLevel: 0.5, stormLevel: Number.NaN });
    expect(merged.seaLevel).toBe(0.5);
    expect(merged.stormLevel).toBe(0);
  });
});

describe('sourceMarkers', () => {
  it('places each spring in grid cells with the emission radius and drops dry ones', () => {
    const level = getLevel('first-flood');
    const [m] = sourceMarkers(DEFAULT_GRID, level.sources);
    expect(m.x).toBeCloseTo(layoutToCell(level.sources[0].u, DEFAULT_GRID.width));
    expect(m.y).toBeCloseTo(layoutToCell(level.sources[0].v, DEFAULT_GRID.height));
    expect(m.radius).toBeCloseTo(level.sources[0].radius * (DEFAULT_GRID.width - 1));
    expect(sourceMarkers(DEFAULT_GRID, [{ u: 0.5, v: 0.5, radius: 0.1, rate: 0 }])).toEqual([]);
  });
});

describe('fitOrbitCameraToWindow', () => {
  const range = boxHeightRange({ minHeight: -9, maxHeight: 30, verticalScale: 1.5 });
  const cornersOnScreen = (cam: OrbitCamera, aspect: number): boolean => {
    const m = cam.viewProjection(aspect);
    const { width: w, height: h } = DEFAULT_GRID;
    for (const x of [-w / 2, w / 2]) {
      for (const z of [-h / 2, h / 2]) {
        for (const y of [range.min, range.max]) {
          const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
          const nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / cw;
          const ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw;
          if (cw <= 0 || Math.abs(nx) > 1 || Math.abs(ny) > 1.001) return false;
        }
      }
    }
    return true;
  };

  it('keeps the three-quarter view on landscape screens and frames the whole box', () => {
    const cam = new OrbitCamera(DEFAULT_GRID);
    fitOrbitCameraToWindow(cam, DEFAULT_GRID, range, 1280 / 800);
    expect(cam.yaw).toBe(ORBIT_DEFAULT_YAW);
    expect(cornersOnScreen(cam, 1280 / 800)).toBe(true);
    // Tight: backing off only as far as needed, so the box stays big.
    cam.zoom(0.9);
    expect(cornersOnScreen(cam, 1280 / 800)).toBe(false);
  });

  it('turns the box a quarter on portrait phones so all of it fits instead of spilling off both sides', () => {
    const aspect = 390 / 844;
    const cam = new OrbitCamera(DEFAULT_GRID);
    fitOrbitCameraToWindow(cam, DEFAULT_GRID, range, aspect);
    expect(Math.abs(cam.yaw - ORBIT_DEFAULT_YAW)).toBeGreaterThan(1);
    expect(cornersOnScreen(cam, aspect)).toBe(true);
    const turnedDistance = cam.distance;
    const unturned = new OrbitCamera(DEFAULT_GRID);
    unturned.pitch = cam.pitch;
    for (let d = unturned.minDistance; d <= unturned.maxDistance && !cornersOnScreen(unturned, aspect); d += 5) unturned.distance = d;
    expect(turnedDistance).toBeLessThan(unturned.distance);
  });
});

describe('SessionEmissionField', () => {
  it('rebuilds only when an input changed and clears the rain brush on release', () => {
    const grid = { width: 16, height: 12 };
    const field = new SessionEmissionField(grid);
    const sources = [{ u: 0.5, v: 0.5, radius: 0.1, rate: 2 }];
    expect(field.update(1, sources, 0)).not.toBeNull();
    expect(field.update(1, sources, 0)).toBeNull();
    field.paintBrush(3, 3, 2);
    const painted = field.update(1, sources, 0)!;
    expect(painted[3 * 16 + 3]).toBeGreaterThan(0);
    field.clearBrush();
    expect(field.update(1, sources, 0)![3 * 16 + 3]).toBe(0);
    field.clearBrush();
    expect(field.update(1, sources, 0)).toBeNull();
    expect(field.update(1, sources, 0.01)![0]).toBeCloseTo(0.01);
  });
});
