// Projector-mode screenshots from a synthetic depth stream through the real relay (dist-server/): the calibration
// wizard's corner step, and the calibrated projection with hand rain running down the sand.
import { startRelayServer } from '../../dist-server/relay-server.js';
import { openApp } from './demo-page-hooks.mjs';
import { DEPTH_SIZE, SANDBOX_CORNERS, startSyntheticSandboxSource } from './synthetic-sandbox-depth-source.mjs';

const VIEWPORT = { width: 1440, height: 900 };
const GRID = { width: 256, height: 192 };
const UNITS_PER_METER = GRID.width / 1.0; // a 100 cm wide box
// Corners a person would click: a couple of pixels inside the walls, so the rim never leaks into the terrain.
const INSET_PX = 2.5;
const CENTER = SANDBOX_CORNERS.reduce((c, p) => ({ x: c.x + p.x / 4, y: c.y + p.y / 4 }), { x: 0, y: 0 });
const PICKED_CORNERS = SANDBOX_CORNERS.map((p) => {
  const len = Math.hypot(CENTER.x - p.x, CENTER.y - p.y);
  return { x: p.x + ((CENTER.x - p.x) / len) * INSET_PX * 1.4, y: p.y + ((CENTER.y - p.y) / len) * INSET_PX * 1.4 };
});

/** What the wizard saves for the synthetic box: its picked corners, flat sand 1 m below the phone. */
function syntheticCalibration() {
  return {
    grid: GRID,
    depthWidth: DEPTH_SIZE.width,
    depthHeight: DEPTH_SIZE.height,
    roiQuad: PICKED_CORNERS,
    referenceDepth: null,
    referencePlaneMeters: 1,
    boxWidthCm: 100,
    unitsPerMeter: UNITS_PER_METER,
    minHeight: -0.12 * UNITS_PER_METER,
    maxHeight: 0.2 * UNITS_PER_METER,
    keystone: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    savedAt: Date.now(),
  };
}

const simulate = (page, seconds) => page.evaluate((n) => window.__livesand.debug.stepFrames(n, 0.25), Math.round(seconds / 0.25));
const waterVolume = (page) => page.evaluate(async () => (await window.__livesand.debug.readWater()).reduce((s, d) => s + d, 0));

// The physical-mode test harness hosts the same wizard component without the app's HUD (its CSS and overlay panel).
async function captureCalibration(browser, baseUrl, viewerUrl) {
  const page = await browser.newPage({ viewport: VIEWPORT });
  try {
    await page.goto(`${baseUrl}/tests/gpu-harness/physical-harness.html?relay=${encodeURIComponent(viewerUrl)}`);
    await page.getByTestId('calibration-wizard').waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForFunction(() => document.querySelector('[data-testid="roi-stage"] canvas')?.width === 256, null, { timeout: 15_000 });
    const box = await page.getByTestId('roi-stage').boundingBox();
    for (const c of PICKED_CORNERS) {
      await page.mouse.click(box.x + (c.x / DEPTH_SIZE.width) * box.width, box.y + (c.y / DEPTH_SIZE.height) * box.height);
    }
    await page.mouse.move(4, 4);
    await page.waitForTimeout(600);
    return await page.screenshot();
  } finally {
    await page.close();
  }
}

async function captureProjection(browser, baseUrl, viewerUrl, scene, log) {
  // Fresh context: no saved calibration in localStorage.
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  try {
    await openApp(page, baseUrl, `?mode=projector&relay=${encodeURIComponent(viewerUrl)}`);
    await page.getByTestId('calibration-wizard').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('wizard-close').click();
    await page.evaluate((cal) => window.__livesandPhysical.applyCalibration(cal, false), syntheticCalibration());
    await page.waitForTimeout(1500); // every cell sees sand before a hand covers part of it
    // A hand rains over the channel head, the water runs down into the dug lake and settles; then a hand comes in
    // over the western hill (forearm across the west wall) and the capture shows rain starting under it.
    const RAIN_SCRIPT = [
      { hands: [{ u: 0.62, v: 0.38 }], sec: 5 },
      { hands: [], sec: 12 },
      { hands: [{ u: 0.2, v: 0.3, arm: [-0.94, -0.34] }], sec: 1.2 },
    ];
    for (const { hands, sec } of RAIN_SCRIPT) {
      scene.hands = hands;
      await page.waitForTimeout(600); // the new depth frames reach the terrain pipeline
      await simulate(page, sec);
    }
    log(`  projector water volume ${(await waterVolume(page)).toFixed(0)}`);
    await page.keyboard.press('h'); // hide the status panel: this is what lands on the sand
    await page.evaluate(() => window.__livesand.debug.stepFrames(1, 1 / 30));
    await page.waitForTimeout(300);
    return await page.screenshot();
  } finally {
    await context.close();
  }
}

/** Returns { calibration?: png, projector?: png } at 1440x900. */
export async function recordProjectorShots(browser, baseUrl, { projector = true, calibration = true, log = console.log } = {}) {
  const relay = await startRelayServer({ port: 0, host: '127.0.0.1' });
  const scene = { hands: [] };
  const source = startSyntheticSandboxSource(`ws://127.0.0.1:${relay.port}/ws?role=source`, scene);
  const viewerUrl = `ws://127.0.0.1:${relay.port}/ws?role=viewer`;
  const shots = {};
  try {
    if (calibration) {
      shots.calibration = await captureCalibration(browser, baseUrl, viewerUrl);
      log('  calibration wizard captured');
    }
    if (projector) shots.projector = await captureProjection(browser, baseUrl, viewerUrl, scene, log);
    return shots;
  } finally {
    source.stop();
    await relay.close();
  }
}
