// Seeded PRNG + value-noise fBm so every terrain is reproducible from a numeric seed.

/** mulberry32: tiny 32-bit PRNG with good distribution; returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TABLE_SIZE = 256;
const TABLE_MASK = TABLE_SIZE - 1;

// Quintic fade keeps the first and second derivatives continuous (no visible lattice creases).
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 2D value noise on an integer lattice (period 256), values in [-1, 1]. */
export class ValueNoise2D {
  private readonly perm = new Uint8Array(TABLE_SIZE * 2);
  private readonly values = new Float32Array(TABLE_SIZE);

  constructor(seed: number) {
    const rand = mulberry32(seed);
    for (let i = 0; i < TABLE_SIZE; i++) {
      this.values[i] = rand() * 2 - 1;
      this.perm[i] = i;
    }
    // Fisher-Yates shuffle driven by the seeded PRNG.
    for (let i = TABLE_SIZE - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = this.perm[i];
      this.perm[i] = this.perm[j];
      this.perm[j] = tmp;
    }
    for (let i = 0; i < TABLE_SIZE; i++) this.perm[i + TABLE_SIZE] = this.perm[i];
  }

  sample(x: number, y: number): number {
    const xf = Math.floor(x);
    const yf = Math.floor(y);
    const sx = fade(x - xf);
    const sy = fade(y - yf);
    const xi = xf & TABLE_MASK;
    const yi = yf & TABLE_MASK;
    const v00 = this.lattice(xi, yi);
    const v10 = this.lattice(xi + 1, yi);
    const v01 = this.lattice(xi, yi + 1);
    const v11 = this.lattice(xi + 1, yi + 1);
    return lerp(lerp(v00, v10, sx), lerp(v01, v11, sx), sy);
  }

  /** Fractal sum of octaves, renormalised to roughly [-1, 1]. */
  fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let freq = 1;
    for (let o = 0; o < octaves; o++) {
      // Per-octave offset decorrelates octaves that would otherwise share lattice points at the origin.
      sum += amp * this.sample(x * freq + o * 17.31, y * freq + o * 31.77);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return norm > 0 ? sum / norm : 0;
  }

  private lattice(x: number, y: number): number {
    return this.values[this.perm[this.perm[x & TABLE_MASK] + (y & TABLE_MASK)]];
  }
}
