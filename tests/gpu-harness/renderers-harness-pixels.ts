// Pixel helpers for the renderer harness: readback statistics, probe windows, canvas blit and world-to-screen projection.

export interface PixelStats {
  distinctColors: number;
  lumaStdDev: number;
  /** Fraction of the 64x48 sample grid that is fiery (strong red, little blue): lava and its glow. */
  warmFraction: number;
  probes: Record<string, [number, number, number]>;
}

/** Probe position (0..1 of the target) and the half-size in pixels of the window averaged around it. */
export interface Probe {
  u: number;
  v: number;
  radius: number;
}

export function pixelStats(data: Uint8Array, width: number, height: number, bgra: boolean, probes: Record<string, Probe>): PixelStats {
  const rgbAt = (px: number, py: number): [number, number, number] => {
    const o = (Math.min(height - 1, Math.max(0, py)) * width + Math.min(width - 1, Math.max(0, px))) * 4;
    return bgra ? [data[o + 2], data[o + 1], data[o]] : [data[o], data[o + 1], data[o + 2]];
  };
  const colors = new Set<number>();
  const lumas: number[] = [];
  let warm = 0;
  for (let sy = 0; sy < 48; sy++) {
    for (let sx = 0; sx < 64; sx++) {
      const [r, g, b] = rgbAt(Math.floor(((sx + 0.5) / 64) * width), Math.floor(((sy + 0.5) / 48) * height));
      colors.add(((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2));
      lumas.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
      if (r > 150 && r > b * 2.5 && r > g * 1.2) warm++;
    }
  }
  const mean = lumas.reduce((a, b) => a + b, 0) / lumas.length;
  const variance = lumas.reduce((a, b) => a + (b - mean) ** 2, 0) / lumas.length;
  const probeColors: Record<string, [number, number, number]> = {};
  for (const [name, { u, v, radius }] of Object.entries(probes)) {
    const cx = Math.floor(u * width);
    const cy = Math.floor(v * height);
    const sum = [0, 0, 0];
    let n = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        rgbAt(cx + dx, cy + dy).forEach((c, k) => (sum[k] += c));
        n++;
      }
    }
    probeColors[name] = [Math.round(sum[0] / n), Math.round(sum[1] / n), Math.round(sum[2] / n)];
  }
  return { distinctColors: colors.size, lumaStdDev: Math.sqrt(variance), warmFraction: warm / (64 * 48), probes: probeColors };
}

/** Copies GPU readback (rgba/bgra) into a 2D canvas; avoids WebGPU canvas presentation, which headless shells may lack. */
export function blitToCanvas(canvas: HTMLCanvasElement, data: Uint8Array, bgra: boolean): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(`Canvas #${canvas.id} has no 2D context`);
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let o = 0; o < image.data.length; o += 4) {
    image.data[o] = data[o + (bgra ? 2 : 0)];
    image.data[o + 1] = data[o + 1];
    image.data[o + 2] = data[o + (bgra ? 0 : 2)];
    image.data[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

/** Projects a world point with a column-major view-projection to 0..1 screen coords (v down); null if behind the camera. */
export function projectToScreen(viewProj: Float32Array, [x, y, z]: [number, number, number]): { u: number; v: number } | null {
  const m = viewProj;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (w <= 1e-6) return null;
  const nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
  const ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
  return { u: nx * 0.5 + 0.5, v: 0.5 - ny * 0.5 };
}
