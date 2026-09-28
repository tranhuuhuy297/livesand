// Still screenshots of virtual mode for the README: the 2D map (Twin Towns) and the 3D view (Flash Flood storm).
import { openApp, step, takeOverVirtualApp } from './demo-page-hooks.mjs';

// 1280x800 CSS keeps the desktop top bar on one row; x1.125 gives 1440x900 PNGs.
const VIEWPORT = { width: 1280, height: 800 };
const DEVICE_SCALE = 1.125;

const SHOTS = {
  // Two springs mid-level: each river spills at its fork into the hollow below a town.
  '2d': { query: '?level=twin-towns&view=2d', simSec: 12 },
  // Storm near its peak over the mountain basin: rain, darker sky and a village starting to flood.
  '3d': { query: '?level=flash-flood&view=3d', simSec: 40 },
};

/** Returns { '2d'?: png, '3d'?: png }. */
export async function recordVirtualShots(browser, baseUrl, { views = ['3d', '2d'], log = console.log } = {}) {
  const shots = {};
  for (const view of views) {
    const { query, simSec } = SHOTS[view];
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE });
    try {
      await openApp(page, baseUrl, query);
      await takeOverVirtualApp(page);
      await page.keyboard.press('Enter');
      await step(page, Math.round(simSec / 0.5), 0.5);
      await page.mouse.move(VIEWPORT.width - 4, VIEWPORT.height / 2); // hover nothing
      await step(page, 1, 1 / 60);
      await page.waitForTimeout(300); // let the briefing card finish fading out
      shots[view] = await page.screenshot({ scale: 'device' });
      const state = await page.evaluate(() => window.__livesand.debug.state());
      log(`  ${view}: ${state.levelName}, ${state.villages.map((v) => `${v.name} ${v.state}`).join(', ')}`);
    } finally {
      await page.close();
    }
  }
  return shots;
}
