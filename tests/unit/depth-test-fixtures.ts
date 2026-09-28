// Shared synthetic depth frames and calibration for depth pipeline unit tests.
import type { DepthFrame } from '../../src/core/depth-frame-protocol';
import { defaultDepthCalibration, type DepthCalibration } from '../../src/core/depth-terrain-processor';
import type { GridSize } from '../../src/core/types';

export const grid: GridSize = { width: 32, height: 24 };

export function makeFrame(width: number, height: number, depthAt: (x: number, y: number) => number): DepthFrame {
  const depthMeters = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) depthMeters[y * width + x] = depthAt(x, y);
  return { width, height, timestampMs: 0, frameIndex: 0, depthMeters };
}

// Hand threshold with these values: 1 - 20/100 - 0.05 = 0.75 m.
export function calibration(depthWidth = grid.width, depthHeight = grid.height, patch: Partial<DepthCalibration> = {}): DepthCalibration {
  return {
    ...defaultDepthCalibration(grid, depthWidth, depthHeight),
    referencePlaneMeters: 1,
    unitsPerMeter: 100,
    minHeight: -10,
    maxHeight: 20,
    handMarginMeters: 0.05,
    smoothing: 0.5,
    changeThreshold: 0.5,
    ...patch,
  };
}

export const flat = (): number => 1;
export const mound = (x: number, y: number): number => 1 - 0.1 * Math.exp(-((x - 16) ** 2 + (y - 12) ** 2) / 20);
export const idx = (x: number, y: number): number => y * grid.width + x;

// Deterministic LCG so the noise test is reproducible.
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}
