#!/usr/bin/env node
// Records the README media into docs/assets/ by driving the real app in headless Chromium (WebGPU on SwiftShader):
//   livesand-demo.gif, livesand-3d.png, livesand-2d.png, livesand-projector.png, livesand-calibration.png,
//   real-sandbox-setup.svg (the app's setup illustration as a standalone file),
//   volcano: livesand-volcano.png + livesand-lava.gif; places: livesand-ha-long.png + livesand-hoi-an.png
// Usage: npm run demo:media [-- --only gif,3d,2d,projector,calibration,setup,volcano,places]
//          [--samples /tmp/livesand-frames] [--out /tmp/livesand-media]   (--out: review somewhere other than docs/assets)
// Projector/calibration shots import the relay from dist-server/ (the npm script builds it first).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { WEBGPU_LAUNCH_ARGS } from './demo-media/demo-page-hooks.mjs';
import { recordHeroGif } from './demo-media/hero-gif-recorder.mjs';
import { recordLavaGif } from './demo-media/lava-gif-recorder.mjs';
import { recordProjectorShots } from './demo-media/projector-and-calibration-shots.mjs';
import { recordVirtualShots } from './demo-media/virtual-mode-screenshots.mjs';
import { recordVolcanoAndPlaceShots } from './demo-media/volcano-and-real-place-screenshots.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 5251;
const ALL = ['gif', '3d', '2d', 'projector', 'calibration', 'setup', 'volcano', 'places'];
// README asset budget for GIFs (GitHub renders larger ones, but the page gets slow on phones).
const MAX_GIF_BYTES = 4 * 1024 * 1024;

const { values } = parseArgs({
  options: { only: { type: 'string' }, samples: { type: 'string' }, out: { type: 'string' } },
  allowPositionals: false,
});
const ASSETS = path.resolve(values.out ?? path.join(ROOT, 'docs', 'assets'));
const only = new Set((values.only ?? ALL.join(',')).split(',').map((s) => s.trim()).filter(Boolean));
for (const name of only) if (!ALL.includes(name)) throw new Error(`unknown --only entry "${name}" (use ${ALL.join(', ')})`);

/** The "Real sandbox" dialog's inline SVG, made standalone (namespace, size, dark card behind it). */
async function exportSetupIllustration(browser) {
  const page = await browser.newPage();
  try {
    await page.goto(`${baseUrl}/`);
    const markup = await page.evaluate(async () => (await import('/src/app/real-sandbox-illustration.ts')).REAL_SANDBOX_ILLUSTRATION);
    const svg = markup
      .trim()
      .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="300" ')
      .replace(/(<svg[^>]*>)/, '$1\n  <rect width="320" height="150" rx="12" fill="#0f172a"/>');
    return Buffer.from(`${svg}\n`);
  } finally {
    await page.close();
  }
}

const save = (name, bytes) => {
  if (name.endsWith('.gif') && bytes.length > MAX_GIF_BYTES) {
    throw new Error(`${name} is ${(bytes.length / 1e6).toFixed(2)} MB, over the ${MAX_GIF_BYTES / 1024 / 1024} MB README budget`);
  }
  const file = path.join(ASSETS, name);
  writeFileSync(file, bytes);
  const shown = path.relative(ROOT, file);
  console.log(`wrote ${shown.startsWith('..') ? file : shown} (${(bytes.length / 1e6).toFixed(2)} MB)`);
};

mkdirSync(ASSETS, { recursive: true });
const vite = await createServer({ root: ROOT, server: { port: PORT, strictPort: true }, logLevel: 'warn' });
await vite.listen();
const baseUrl = `http://localhost:${PORT}`;
const browser = await chromium.launch({ args: WEBGPU_LAUNCH_ARGS });
try {
  if (only.has('gif')) {
    console.log('recording hero GIF...');
    save('livesand-demo.gif', await recordHeroGif(browser, baseUrl, { samplesDir: values.samples ?? null }));
  }
  if (only.has('3d') || only.has('2d')) {
    const shots = await recordVirtualShots(browser, baseUrl, { views: ALL.filter((v) => (v === '3d' || v === '2d') && only.has(v)) });
    for (const [view, png] of Object.entries(shots)) save(`livesand-${view}.png`, png);
  }
  if (only.has('setup')) save('real-sandbox-setup.svg', await exportSetupIllustration(browser));
  if (only.has('projector') || only.has('calibration')) {
    const shots = await recordProjectorShots(browser, baseUrl, { projector: only.has('projector'), calibration: only.has('calibration') });
    for (const [name, png] of Object.entries(shots)) save(`livesand-${name}.png`, png);
  }
  if (only.has('volcano') || only.has('places')) {
    const names = [...(only.has('volcano') ? ['volcano'] : []), ...(only.has('places') ? ['ha-long', 'hoi-an'] : [])];
    console.log('recording volcano and real-place stills...');
    const shots = await recordVolcanoAndPlaceShots(browser, baseUrl, { names });
    for (const [name, png] of Object.entries(shots)) save(`livesand-${name}.png`, png);
  }
  if (only.has('volcano')) {
    console.log('recording lava GIF...');
    save('livesand-lava.gif', await recordLavaGif(browser, baseUrl, { samplesDir: values.samples ?? null }));
  }
} finally {
  await browser.close();
  await vite.close();
}
