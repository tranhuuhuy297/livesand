// Spatial filters over the terrain grid used by the depth -> terrain pipeline.
import type { GridSize } from './types';

/** 3x3 dilation: bilinear samples at hand edges mix hand and sand depth and would read as fake peaks. */
export function dilateMask(src: Uint8Array, dst: Uint8Array, grid: GridSize): void {
  const { width: w, height: h } = grid;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1);
      let v = 0;
      for (let yy = y0; yy <= y1 && v === 0; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          if (src[yy * w + xx]) { v = 1; break; }
        }
      }
      dst[y * w + x] = v;
    }
  }
}

/**
 * Separable Gaussian that averages only cells with a non-zero weight and renormalizes, so never-seen cells and the
 * grid border don't drag neighbours down; a cell with no weighted neighbour keeps its own value.
 */
export class MaskedGaussianBlur {
  private readonly radius: number;
  private readonly kernel: Float64Array;
  private readonly rowValue: Float64Array;
  private readonly rowWeight: Float64Array;

  constructor(private readonly grid: GridSize, readonly sigma: number) {
    if (!(sigma > 0) || !Number.isFinite(sigma)) throw new RangeError(`Blur sigma must be > 0 (got ${sigma})`);
    this.radius = Math.max(1, Math.ceil(sigma * 3));
    this.kernel = new Float64Array(this.radius * 2 + 1);
    for (let j = -this.radius; j <= this.radius; j++) this.kernel[j + this.radius] = Math.exp(-(j * j) / (2 * sigma * sigma));
    this.rowValue = new Float64Array(grid.width * grid.height);
    this.rowWeight = new Float64Array(grid.width * grid.height);
  }

  apply(src: Float32Array, weight: Uint8Array, dst: Float32Array): void {
    const { width: w, height: h } = this.grid;
    const { radius: r, kernel: k, rowValue, rowWeight } = this;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let sv = 0, sw = 0;
        for (let xx = Math.max(0, x - r), x1 = Math.min(w - 1, x + r); xx <= x1; xx++) {
          if (weight[row + xx] === 0) continue;
          const kk = k[xx - x + r];
          sv += kk * src[row + xx];
          sw += kk;
        }
        rowValue[row + x] = sv;
        rowWeight[row + x] = sw;
      }
    }
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      for (let x = 0; x < w; x++) {
        let sv = 0, sw = 0;
        for (let yy = y0; yy <= y1; yy++) {
          const kk = k[yy - y + r];
          sv += kk * rowValue[yy * w + x];
          sw += kk * rowWeight[yy * w + x];
        }
        const i = y * w + x;
        dst[i] = sw > 1e-12 ? sv / sw : src[i];
      }
    }
  }
}
