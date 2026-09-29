// README stills for the volcano and real places, all in 3D: Mount Ember mid-eruption (lava turned by the player's wall
// runs into the sea), Hạ Long Bay (karst towers in the sea, with its place card) and Hội An Floods (typhoon flooding).
import { appState, openApp, parkPointer, setCamera, step, stepUntil, takeOverVirtualApp } from './demo-page-hooks.mjs';
import { dragEmberWall } from './mount-ember-wall-stroke.mjs';

// 1280x800 CSS keeps the desktop top bar on one row; x1.125 gives 1440x900 PNGs like the other stills.
const VIEWPORT = { width: 1280, height: 800 };
const DEVICE_SCALE = 1.125;

/** Output name -> page, timing and camera (world units: x east, y up, z south; yaw 0 looks north). */
export const VOLCANO_AND_PLACE_SHOTS = {
  // Wall built during the rumble; by 64 s the lava has run down the old channel and steams where it meets the sea.
  volcano: {
    query: '?level=mount-ember&view=3d',
    wallAtSec: 3,
    simSec: 64,
    camera: { target: [-8, 8, -12], distance: 210, yaw: 0.95, pitch: 0.55 },
  },
  // Free play right after the download: the prefilled bay among the karst towers, and the place card.
  'ha-long': { query: '?place=ha-long-bay&view=3d', simSec: 0, camera: { target: [-20, 4, -10], distance: 200, yaw: 0.35, pitch: 0.45 } },
  // Idle play, from upriver: the typhoon swells the Thu Bồn over its banks into the Old Town, the sea beyond.
  'hoi-an': { query: '?level=hoi-an-floods&view=3d', simSec: 44, camera: { target: [-40, 4, 0], distance: 150, yaw: -0.8, pitch: 0.5 } },
};

async function shoot(browser, baseUrl, spec) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE });
  try {
    await openApp(page, baseUrl, spec.query);
    await takeOverVirtualApp(page);
    await setCamera(page, spec.camera);
    // Levels wait under their briefing card; free play is already running.
    if ((await appState(page)).phase === 'ready') await page.keyboard.press('Enter');
    if (spec.wallAtSec !== undefined) {
      await stepUntil(page, spec.wallAtSec);
      await dragEmberWall(page);
    }
    await parkPointer(page);
    await stepUntil(page, spec.simSec);
    await step(page, 1, 1 / 30);
    await page.waitForTimeout(400); // let the briefing card finish fading out
    const png = await page.screenshot({ scale: 'device' });
    return { png, state: await appState(page) };
  } finally {
    await page.close();
  }
}

/** Returns { [name]: png } for the requested shot names (keys of VOLCANO_AND_PLACE_SHOTS). */
export async function recordVolcanoAndPlaceShots(browser, baseUrl, { names = Object.keys(VOLCANO_AND_PLACE_SHOTS), log = console.log } = {}) {
  const shots = {};
  for (const name of names) {
    const spec = VOLCANO_AND_PLACE_SHOTS[name];
    if (!spec) throw new Error(`unknown still "${name}"`);
    const { png, state } = await shoot(browser, baseUrl, spec);
    const villages = state.villages.map((v) => `${v.name} ${v.state}`).join(', ') || 'no villages';
    log(`  ${name}: ${state.levelName} at ${state.elapsedSec.toFixed(1)} s, ${villages}`);
    if (state.gpuErrors.length > 0) throw new Error(`${name}: GPU errors: ${state.gpuErrors.join('; ')}`);
    shots[name] = png;
  }
  return shots;
}
