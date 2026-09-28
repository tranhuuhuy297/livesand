// False-colour previews for pairing/calibration: raw depth (auto-ranged) and processed terrain heights.
import type { DepthFrame } from '../../core/depth-frame-protocol';
import type { GridSize } from '../../core/types';

type Stop = [t: number, r: number, g: number, b: number];

// Far = cool, near = warm, so hands and piles pop out of the preview.
const DEPTH_STOPS: Stop[] = [
  [0, 24, 20, 64], [0.2, 45, 92, 200], [0.42, 30, 190, 200], [0.62, 120, 225, 90], [0.8, 250, 190, 60], [1, 225, 60, 45],
];
// AR-sandbox elevation ramp: deep water -> shore -> grass -> sand -> rock -> snow.
const ELEVATION_STOPS: Stop[] = [
  [0, 18, 52, 140], [0.22, 40, 140, 200], [0.36, 90, 180, 110], [0.55, 60, 150, 60], [0.72, 225, 200, 100],
  [0.86, 150, 100, 60], [1, 245, 245, 245],
];
const HAND_TINT: [number, number, number] = [255, 80, 200];
const INVALID_RGB: [number, number, number] = [10, 12, 16];
// Range easing stops the colours from flickering as the auto-range follows noisy percentiles.
const RANGE_EASE = 0.15;

function buildLut(stops: Stop[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, r0, g0, b0] = stops[k];
    const [t1, r1, g1, b1] = stops[k + 1];
    const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    lut[i * 3] = r0 + (r1 - r0) * f;
    lut[i * 3 + 1] = g0 + (g1 - g0) * f;
    lut[i * 3 + 2] = b0 + (b1 - b0) * f;
  }
  return lut;
}

function gradientCss(stops: Stop[]): string {
  return `linear-gradient(90deg, ${stops.map(([t, r, g, b]) => `rgb(${r} ${g} ${b}) ${Math.round(t * 100)}%`).join(', ')})`;
}

const DEPTH_LUT = buildLut(DEPTH_STOPS);
const ELEVATION_LUT = buildLut(ELEVATION_STOPS);
export const DEPTH_GRADIENT_CSS = gradientCss(DEPTH_STOPS);
export const ELEVATION_GRADIENT_CSS = gradientCss(ELEVATION_STOPS);

export interface DepthRange {
  near: number;
  far: number;
}

/** 2nd / 98th percentile of valid depth, sampled sparsely (cheap enough per frame). */
function depthPercentiles(depth: Float32Array): DepthRange | null {
  const stride = Math.max(1, Math.floor(depth.length / 4096));
  const values: number[] = [];
  for (let i = 0; i < depth.length; i += stride) if (depth[i] > 0) values.push(depth[i]);
  if (values.length < 8) return null;
  values.sort((a, b) => a - b);
  return { near: values[Math.floor(values.length * 0.02)], far: values[Math.floor(values.length * 0.98)] };
}

export class FalseColorCanvas {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private image: ImageData | null = null;
  private range: DepthRange | null = null;

  constructor(className = 'lsp-preview-canvas') {
    this.canvas = document.createElement('canvas');
    this.canvas.className = className;
    this.ctx = this.canvas.getContext('2d');
  }

  /** Current auto-range of the depth view (meters), or null before the first valid frame. */
  get depthRange(): DepthRange | null {
    return this.range;
  }

  drawDepth(frame: DepthFrame): DepthRange | null {
    const target = depthPercentiles(frame.depthMeters);
    if (target) {
      const r = this.range;
      this.range = r
        ? { near: r.near + (target.near - r.near) * RANGE_EASE, far: r.far + (target.far - r.far) * RANGE_EASE }
        : target;
    }
    const pixels = this.pixels(frame.width, frame.height);
    if (!pixels) return this.range;
    const near = this.range?.near ?? 0;
    const span = Math.max(0.01, (this.range?.far ?? 1) - near);
    const depth = frame.depthMeters;
    for (let i = 0; i < depth.length; i++) {
      const d = depth[i];
      if (d > 0) this.put(pixels.data, i, DEPTH_LUT, 1 - (d - near) / span);
      else this.putRgb(pixels.data, i, INVALID_RGB);
    }
    this.ctx?.putImageData(pixels, 0, 0);
    return this.range;
  }

  drawHeights(heights: Float32Array, grid: GridSize, min: number, max: number, handMask: Uint8Array | null): void {
    const pixels = this.pixels(grid.width, grid.height);
    if (!pixels) return;
    const span = Math.max(1e-6, max - min);
    for (let i = 0; i < heights.length; i++) {
      if (handMask && handMask[i]) this.putRgb(pixels.data, i, HAND_TINT);
      else this.put(pixels.data, i, ELEVATION_LUT, (heights[i] - min) / span);
    }
    this.ctx?.putImageData(pixels, 0, 0);
  }

  private pixels(width: number, height: number): ImageData | null {
    if (!this.ctx) return null;
    if (!this.image || this.image.width !== width || this.image.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.image = this.ctx.createImageData(width, height);
    }
    return this.image;
  }

  private put(data: Uint8ClampedArray, i: number, lut: Uint8ClampedArray, t: number): void {
    const k = Math.min(255, Math.max(0, Math.round(t * 255))) * 3;
    data[i * 4] = lut[k];
    data[i * 4 + 1] = lut[k + 1];
    data[i * 4 + 2] = lut[k + 2];
    data[i * 4 + 3] = 255;
  }

  private putRgb(data: Uint8ClampedArray, i: number, rgb: [number, number, number]): void {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
}
