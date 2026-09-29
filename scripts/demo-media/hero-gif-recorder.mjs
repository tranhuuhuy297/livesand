// Records the README hero GIF: level 1 in 3D, the lake floods Millbrook, one Dig swipe to the sea saves it.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DeltaGifEncoder, encodePng } from './delta-gif-encoder.mjs';
import { appState, captureHalf, fakeCursorPosition, installFakeCursor, moveToGrid, openApp, step, takeOverVirtualApp } from './demo-page-hooks.mjs';

const FRAME_MS = 60; // ~16.7 fps playback
const GRID = { width: 256, height: 192 };
// Level-1 layout (u, v) of Millbrook and the point on the coast straight east of it (same swipe as the e2e win test).
const VILLAGE_UV = { u: 0.43, v: 0.73 };
const SEA_UV = { u: 0.9, v: 0.73 };
const SWIPE_CELLS_PER_SEC = 48;
const SWIPE_FRAME_SEC = 0.1;
// Closer than the default fit, centred between the village and the sea.
const CAMERA = { target: [12, 4, 22], distance: 260 };

const toGrid = ({ u, v }) => ({ x: u * (GRID.width - 1), y: v * (GRID.height - 1) });
const easeOut = (t) => 1 - (1 - t) ** 3;
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const villageStates = async (page) =>
  JSON.stringify((await appState(page)).villages.map((v) => `${v.state} ${v.floodedSec.toFixed(1)}s`));

/** Returns the GIF bytes; `samplesDir` receives a few full-size frames as PNG for review. */
export async function recordHeroGif(browser, baseUrl, { samplesDir = null, log = console.log } = {}) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 625 }, deviceScaleFactor: 1.44 });
  try {
    await openApp(page, baseUrl, '?level=first-flood&view=3d');
    await takeOverVirtualApp(page);
    await installFakeCursor(page);
    await page.evaluate((cam) => Object.assign(window.__demoApp.camera, cam), CAMERA);
    const gif = new DeltaGifEncoder();
    const samples = [];
    const shoot = async ({ delayMs = FRAME_MS, newScene = false, dither = false, sample = false } = {}) => {
      const image = await captureHalf(page);
      gif.addFrame(image, delayMs, { newScene, dither });
      if (sample) samples.push(image);
    };

    // Briefing dismissed; the springs already ran at load, so the river flows. Fast-forward (unrecorded) to 9 s.
    await page.keyboard.press('Enter');
    await step(page, 18, 0.5);

    // Scene 1 (9 s of sim at ~3.3x): the lake rises into Millbrook, which starts to flood; the pointer drifts in.
    const village = toGrid(VILLAGE_UV);
    const hoverFrom = { x: village.x + 75, y: village.y - 45 };
    const RISE_FRAMES = 45;
    const ENTER_FRAMES = 16;
    for (let i = 0; i < RISE_FRAMES; i++) {
      const k = i - (RISE_FRAMES - ENTER_FRAMES);
      if (k >= 0) await moveToGrid(page, lerp(hoverFrom, village, easeOut((k + 1) / ENTER_FRAMES)));
      await step(page, 2, 0.1);
      await shoot({ sample: i === 0 || i === RISE_FRAMES - 1 });
    }
    log(`  flooding: ${await villageStates(page)}`);

    // Scene 2: one Dig swipe from the village straight east to the sea (~1.4x).
    const sea = toGrid(SEA_UV);
    const swipeFrames = Math.ceil((sea.x - village.x) / SWIPE_CELLS_PER_SEC / SWIPE_FRAME_SEC);
    await page.mouse.down();
    for (let i = 1; i <= swipeFrames; i++) {
      await moveToGrid(page, lerp(village, sea, i / swipeFrames));
      await step(page, 1, SWIPE_FRAME_SEC);
      await shoot({ delayMs: 70, sample: i === Math.round(swipeFrames * 0.6) });
    }
    await page.mouse.up();

    // Scene 3 (7 s of sim at ~3.3x): the lake drains through the new channel; the pointer moves off the channel.
    const rest = { x: sea.x + 6, y: sea.y - 34 };
    const DRAIN_FRAMES = 35;
    for (let i = 0; i < DRAIN_FRAMES; i++) {
      if (i < 10) await moveToGrid(page, lerp(sea, rest, easeOut((i + 1) / 10)));
      await step(page, 2, 0.1);
      await shoot({ sample: i === DRAIN_FRAMES - 1 });
    }
    log(`  drained: ${await villageStates(page)}`);

    // Hold the level to the end of its clock (unrecorded), then the result card; the pointer glides to "Star".
    let s = await appState(page);
    for (let guard = 0; guard < 40 && s.phase === 'running'; guard++) {
      await step(page, 10, 0.5);
      s = await appState(page);
    }
    if (s.phase !== 'won') throw new Error(`hero GIF: expected level 1 to be won, got phase "${s.phase}"`);
    await step(page, 5, 0.5); // the result card waits for ~2 s of frames after the level ends
    await page.waitForTimeout(800); // result card pop-in animation
    await shoot({ newScene: true, dither: true, delayMs: 700 });
    const star = await page.locator('.ls-result .ls-star-link').boundingBox();
    if (!star) throw new Error('hero GIF: result card has no Star on GitHub link');
    const from = await fakeCursorPosition(page);
    const to = { x: star.x + star.width * 0.62, y: star.y + star.height * 0.6 };
    const GLIDE_FRAMES = 12;
    for (let i = 1; i <= GLIDE_FRAMES; i++) {
      const p = lerp(from, to, easeOut(i / GLIDE_FRAMES));
      await page.mouse.move(p.x, p.y);
      if (i === GLIDE_FRAMES) await page.waitForTimeout(300); // hover transition
      await shoot({ delayMs: i === GLIDE_FRAMES ? 2600 : FRAME_MS, sample: i === GLIDE_FRAMES });
    }

    const { bytes, frames } = gif.encode();
    log(`  hero GIF: ${gif.frameCount} captured frames -> ${frames} GIF frames, ${(bytes.length / 1e6).toFixed(2)} MB`);
    if (samplesDir) {
      mkdirSync(samplesDir, { recursive: true });
      samples.forEach((img, i) => writeFileSync(path.join(samplesDir, `hero-frame-${i}.png`), encodePng(img)));
    }
    return bytes;
  } finally {
    await page.close();
  }
}
