// Frame-delta GIF encoding for the README demo: one palette per scene, unchanged pixels written as transparent.
import gifenc from 'gifenc';
import { PNG } from 'pngjs';

const { GIFEncoder, quantize, applyPalette } = gifenc;

/** Decodes a PNG buffer (e.g. a Playwright screenshot) into RGBA pixels. */
export function decodePng(buffer) {
  const png = PNG.sync.read(buffer);
  return { width: png.width, height: png.height, data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length) };
}

export function encodePng(image) {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length);
  return PNG.sync.write(png, { colorType: 6 });
}

/** Halves an RGBA image with a 2x2 box filter (screenshots are taken at 2x for clean antialiasing). */
export function downsample2x(image) {
  const width = image.width >> 1;
  const height = image.height >> 1;
  const src = image.data;
  const out = new Uint8Array(width * height * 4);
  const stride = image.width * 4;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = (y * 2) * stride + x * 8;
      const b = a + stride;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) out[o + c] = (src[a + c] + src[a + 4 + c] + src[b + c] + src[b + 4 + c] + 2) >> 2;
    }
  }
  return { width, height, data: out };
}

/** Every `step`-th pixel of each frame, concatenated, so one palette can be fitted to a whole scene. */
function samplePixels(frames, step) {
  const perFrame = Math.ceil(frames[0].data.length / 4 / step);
  const out = new Uint8Array(perFrame * frames.length * 4);
  let o = 0;
  for (const frame of frames) {
    for (let p = 0; p < frame.data.length; p += step * 4, o += 4) out.set(frame.data.subarray(p, p + 4), o);
  }
  return out.subarray(0, o);
}

// 4x4 Bayer thresholds in -0.5..0.5: position-only, so static regions dither identically in every frame.
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);

/** Ordered dither before palette mapping: hides banding in smooth gradients (blurred backdrops) at little cost. */
function orderedDither(image, spread) {
  const { width, height, data } = image;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const d = BAYER4[(y & 3) * 4 + (x & 3)] * spread;
      for (let c = 0; c < 3; c++) out[o + c] = Math.max(0, Math.min(255, Math.round(data[o + c] + d)));
      out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * Collects frames, then writes a looping GIF. Frames of one scene share a 255-colour palette; after the scene's first
 * frame only changed pixels are stored (the rest use the transparent index and "do not dispose"), so a static camera
 * with moving water compresses well. Identical consecutive frames are merged into one longer frame.
 */
export class DeltaGifEncoder {
  constructor() {
    this.scenes = [];
  }

  /**
   * `newScene` starts a fresh palette and a full keyframe (use it after big visual changes such as a dialog);
   * `dither` (per scene, set on its first frame) applies ordered dithering to that scene.
   */
  addFrame(image, delayMs, { newScene = false, dither = false } = {}) {
    if (newScene || this.scenes.length === 0) this.scenes.push(Object.assign([], { dither }));
    this.scenes.at(-1).push({ image, delayMs });
  }

  get frameCount() {
    return this.scenes.reduce((n, s) => n + s.length, 0);
  }

  encode() {
    const first = this.scenes[0]?.[0]?.image;
    if (!first) throw new Error('DeltaGifEncoder: no frames');
    const { width, height } = first;
    const pixelCount = width * height;
    const records = [];
    this.scenes.forEach((scene, sceneIndex) => {
      const palette = quantize(samplePixels(scene.map((f) => f.image), 3), 255, { format: 'rgb565' });
      const transparentIndex = palette.length;
      const fullPalette = [...palette, [255, 0, 255]];
      // The first scene's palette becomes the global table; later scenes need a local table on every frame.
      const framePalette = sceneIndex === 0 ? null : fullPalette;
      let shown = null;
      scene.forEach(({ image, delayMs }, i) => {
        if (image.width !== width || image.height !== height) throw new Error('DeltaGifEncoder: frame sizes differ');
        const index = applyPalette(scene.dither ? orderedDither(image, 20) : image.data, palette, 'rgb565');
        if (i === 0) {
          shown = index.slice();
          records.push({ index, delayMs, palette: fullPalette, transparent: false, transparentIndex });
          return;
        }
        let changed = 0;
        const delta = new Uint8Array(pixelCount);
        for (let p = 0; p < pixelCount; p++) {
          if (index[p] === shown[p]) delta[p] = transparentIndex;
          else {
            delta[p] = index[p];
            shown[p] = index[p];
            changed++;
          }
        }
        if (changed === 0) records.at(-1).delayMs += delayMs;
        else records.push({ index: delta, delayMs, palette: framePalette, transparent: true, transparentIndex });
      });
    });
    const gif = GIFEncoder();
    records.forEach((r) => {
      gif.writeFrame(r.index, width, height, {
        palette: r.palette ?? undefined,
        delay: r.delayMs,
        transparent: r.transparent,
        transparentIndex: r.transparentIndex,
        dispose: 1,
        repeat: 0,
      });
    });
    gif.finish();
    return { bytes: gif.bytes(), frames: records.length };
  }
}
