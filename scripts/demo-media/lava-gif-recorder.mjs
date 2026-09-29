// Records the README lava GIF on Mount Ember in 3D: lava pours from the crater down the gully toward Emberton, a Raise
// wall dragged across the gully turns it into the old channel, and it runs into the sea in clouds of steam.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DeltaGifEncoder, encodePng } from './delta-gif-encoder.mjs';
import { appState, captureHalf, fakeCursorPosition, gridToClient, installFakeCursor, openApp, setCamera, step, stepUntil, takeOverVirtualApp } from './demo-page-hooks.mjs';
import { dragEmberWall, emberWallPath } from './mount-ember-wall-stroke.mjs';

const FRAME_MS = 60; // ~16.7 fps playback
// 1280x800 CSS keeps the top bar on one row; x1.125 then halved gives a 720 px GIF like the hero.
const VIEWPORT = { width: 1280, height: 800 };
const DEVICE_SCALE = 1.125;
// Looking north across the wall line: crater, gully, Emberton, the old channel east and the sea in one frame.
const CAMERA = { target: [-14, 8, -8], distance: 222, yaw: 0.2, pitch: 0.72 };
// Level clock: the hint line has faded by 10 s; lava reaches the fork at ~20 s and the wall line at ~23 s.
const RECORD_FROM_SEC = 10;
const WALL_AT_SEC = 21;
// By then the diverted lava has run down the old channel and piled up in the sea.
const RECORD_TO_SEC = 64;
const POUR_SEC_PER_FRAME = 0.3;
const DIVERT_SEC_PER_FRAME = 0.6;
const GLIDE_FRAMES = 10;
const END_HOLD_MS = 2500;

const easeOut = (t) => 1 - (1 - t) ** 3;
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Returns the GIF bytes; `samplesDir` receives a few full-size frames as PNG for review. */
export async function recordLavaGif(browser, baseUrl, { samplesDir = null, log = console.log } = {}) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE });
  try {
    await openApp(page, baseUrl, '?level=mount-ember&view=3d');
    await takeOverVirtualApp(page);
    await installFakeCursor(page);
    await setCamera(page, CAMERA);
    const gif = new DeltaGifEncoder();
    const samples = [];
    const shoot = async ({ delayMs = FRAME_MS, sample = false } = {}) => {
      const image = await captureHalf(page);
      gif.addFrame(image, delayMs);
      if (sample) samples.push(image);
    };
    // Pointer rests over the sky (no brush ring) before and after the wall.
    const sky = { x: VIEWPORT.width * 0.88, y: VIEWPORT.height * 0.22 };

    // The briefing is dismissed; fast-forward (unrecorded) through the rumble that fills the crater.
    await page.keyboard.press('Enter');
    await stepUntil(page, RECORD_FROM_SEC);

    // Scene 1: the crater overflows and lava pours down the gully; the pointer glides to one end of the wall line.
    const { from } = await emberWallPath(page);
    const wallStart = await gridToClient(page, from.x, from.y);
    if (!wallStart) throw new Error('lava GIF: the wall line is off screen with this camera');
    await page.mouse.move(sky.x, sky.y);
    const pourFrames = Math.round((WALL_AT_SEC - RECORD_FROM_SEC) / POUR_SEC_PER_FRAME);
    for (let i = 0; i < pourFrames; i++) {
      const k = i - (pourFrames - GLIDE_FRAMES);
      if (k >= 0) {
        const p = lerp(sky, wallStart, easeOut((k + 1) / GLIDE_FRAMES));
        await page.mouse.move(p.x, p.y);
      }
      await step(page, 2, POUR_SEC_PER_FRAME / 2);
      await shoot({ sample: i === pourFrames - 1 });
    }
    log(`  lava GIF: wall starts at ${(await appState(page)).elapsedSec.toFixed(1)} s`);

    // Scene 2: three brisk passes of Raise across the gully, just below the fork.
    let wallFrame = 0;
    await dragEmberWall(page, { passes: 3, moves: 6, dt: 0.15, draw: true, onFrame: () => shoot({ delayMs: 70, sample: ++wallFrame === 18 }) });
    const leaveFrom = await fakeCursorPosition(page);

    // Scene 3: the lava meets the wall, turns east down the old channel and steams into the sea.
    let s = await appState(page);
    for (let i = 0; s.phase === 'running' && s.elapsedSec < RECORD_TO_SEC; i++) {
      if (i < GLIDE_FRAMES) {
        const p = lerp(leaveFrom, sky, easeOut((i + 1) / GLIDE_FRAMES));
        await page.mouse.move(p.x, p.y);
      }
      await step(page, 3, DIVERT_SEC_PER_FRAME / 3);
      s = await appState(page);
      const last = s.elapsedSec >= RECORD_TO_SEC - 1e-6;
      await shoot({ delayMs: last ? END_HOLD_MS : FRAME_MS, sample: i === 30 || last });
    }
    const village = s.villages[0];
    log(`  lava GIF: ${village.name} ${village.state} at ${s.elapsedSec.toFixed(1)} s`);
    if (village.state !== 'safe') throw new Error(`lava GIF: expected ${village.name} to stay safe, got "${village.state}"`);

    const { bytes, frames } = gif.encode();
    log(`  lava GIF: ${gif.frameCount} captured frames -> ${frames} GIF frames, ${(bytes.length / 1e6).toFixed(2)} MB`);
    if (samplesDir) {
      mkdirSync(samplesDir, { recursive: true });
      samples.forEach((img, i) => writeFileSync(path.join(samplesDir, `lava-frame-${i}.png`), encodePng(img)));
    }
    return bytes;
  } finally {
    await page.close();
  }
}
