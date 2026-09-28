#!/usr/bin/env node
// Records the README media into docs/assets/ by driving the real app in headless Chromium (WebGPU on SwiftShader):
//   livesand-demo.gif, livesand-3d.png, livesand-2d.png, livesand-projector.png, livesand-calibration.png,
//   real-sandbox-setup.svg (the app's setup illustration as a standalone file)
// Usage: npm run demo:media [-- --only gif,3d,2d,projector,calibration,setup] [--samples /tmp/livesand-frames]
// Projector/calibration shots import the relay from dist-server/ (the npm script builds it first).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { WEBGPU_LAUNCH_ARGS } from './demo-media/demo-page-hooks.mjs';
import { recordHeroGif } from './demo-media/hero-gif-recorder.mjs';
import { recordProjectorShots } from './demo-media/projector-and-calibration-shots.mjs';
import { recordVirtualShots } from './demo-media/virtual-mode-screenshots.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = path.join(ROOT, 'docs', 'assets');
const PORT = 5251;
const ALL = ['gif', '3d', '2d', 'projector', 'calibration', 'setup'];

const { values } = parseArgs({
  options: { only: { type: 'string' }, samples: { type: 'string' } },
  allowPositionals: false,
});
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
  const file = path.join(ASSETS, name);
  writeFileSync(file, bytes);
  console.log(`wrote ${path.relative(ROOT, file)} (${(bytes.length / 1e6).toFixed(2)} MB)`);
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
} finally {
  await browser.close();
  await vite.close();
}
