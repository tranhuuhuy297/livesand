// Browser-side helpers for recording: open the app, reach the running VirtualModeApp, fake mouse cursor, capture.
import { decodePng, downsample2x } from './delta-gif-encoder.mjs';

// ANGLE on SwiftShader lets headless Chromium present a WebGPU canvas without a GPU (same flags as the e2e suite).
export const WEBGPU_LAUNCH_ARGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader'];

/** Loads `query` and waits for window.__livesand.ready (retries once: Vite may reload while pre-bundling). */
export async function openApp(page, baseUrl, query) {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(`${baseUrl}/${query}`);
      await page.waitForFunction(() => window.__livesand?.ready === true || Boolean(window.__livesand?.error), null, { timeout: 90_000 });
      break;
    } catch (err) {
      if (attempt >= 2) throw err;
    }
  }
  const error = await page.evaluate(() => window.__livesand?.error ?? null);
  if (error) throw new Error(`LiveSand failed to boot: ${error}`);
}

/**
 * Exposes the running VirtualModeApp as window.__demoApp (via the dev server's module graph) and stops its rAF loop,
 * so every frame is produced by debug.stepFrames at a fixed dt and screenshots never wait on a busy software GPU.
 */
export async function takeOverVirtualApp(page) {
  await page.evaluate(async () => {
    const mod = await import('/src/app/virtual-mode-app.ts');
    const original = mod.VirtualModeApp.prototype.advance;
    mod.VirtualModeApp.prototype.advance = function (...args) {
      window.__demoApp = this;
      return original.apply(this, args);
    };
  });
  await page.waitForFunction(() => Boolean(window.__demoApp), null, { timeout: 30_000 });
  await page.evaluate(() => window.__demoApp.loop.stop());
}

/**
 * Runs `n` frames of `dt` seconds (drawing only the last unless `draw` is false), then redraws the overlays the live
 * loop would have drawn: brush ring, level hint line and north arrow.
 */
export async function step(page, n, dt, draw = true) {
  await page.evaluate(([count, seconds, drawLast]) => window.__livesand.debug.stepFrames(count, seconds, drawLast), [n, dt, draw]);
  if (!draw) return;
  await page.evaluate(() => {
    const app = window.__demoApp;
    if (!app) return;
    const { pointer } = app.input;
    const brush = { client: pointer.brushClient, tool: app.tool, radius: app.brushRadius, active: pointer.stroking };
    app.screen.drawOverlays(app.geometry(), app.session, brush);
  });
}

/** Hides the brush ring for a still: close-up 3D cameras fill the window, so no screen edge is off the terrain. */
export async function parkPointer(page) {
  const size = page.viewportSize();
  await page.mouse.move(size.width - 4, size.height / 2);
  await page.evaluate(() => {
    const init = { pointerType: 'mouse', pointerId: 1, isPrimary: true };
    document.querySelector('canvas.ls-canvas')?.dispatchEvent(new PointerEvent('pointerleave', init));
  });
}

/** Game state snapshot from the debug API. */
export function appState(page) {
  return page.evaluate(() => window.__livesand.debug.state());
}

/** Fast-forwards (undrawn, `dt` per frame) until the level clock reaches `sec` or the attempt ends. */
export async function stepUntil(page, sec, dt = 0.5) {
  let s = await appState(page);
  while (s.phase === 'running' && s.elapsedSec < sec - 1e-6) {
    await step(page, Math.max(1, Math.min(8, Math.ceil((sec - s.elapsedSec) / dt))), dt, false);
    s = await appState(page);
  }
  return s;
}

/** Points the 3D camera: `{ target, distance, yaw, pitch }` (any subset). */
export async function setCamera(page, camera) {
  await page.evaluate((cam) => Object.assign(window.__demoApp.camera, cam), camera);
}

/** Client-space point of grid cell (gx, gy) on the terrain surface in the current view. */
export async function gridToClient(page, gx, gy) {
  return page.evaluate(async ([x, y]) => {
    const { gridToScreen } = await import('/src/app/view-screen-mapping.ts');
    const app = window.__demoApp;
    const g = app.geometry();
    const viewProj = g.view === '3d' ? g.camera.viewProjection(g.rect.width / g.rect.height) : null;
    const { width, height } = g.grid;
    const h = g.heights[Math.round(Math.min(height - 1, Math.max(0, y))) * width + Math.round(Math.min(width - 1, Math.max(0, x)))];
    return gridToScreen(g, viewProj, x, y, h); // raw height: gridToScreen applies the view's vertical scale
  }, [gx, gy]);
}

/** Moves the mouse onto grid cell `p` ({ x, y }) on the current terrain surface. */
export async function moveToGrid(page, p) {
  const client = await gridToClient(page, p.x, p.y);
  if (!client) throw new Error(`grid cell ${p.x.toFixed(1)},${p.y.toFixed(1)} is not on screen with this camera`);
  await page.mouse.move(client.x, client.y);
}

/** A drawn arrow pointer that follows real mouse events (headless screenshots have no OS cursor). */
export async function installFakeCursor(page) {
  await page.evaluate(() => {
    const el = document.createElement('div');
    el.id = 'demo-cursor';
    el.innerHTML =
      '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2.5v17.2l4.6-4.3 2.9 6.6 3-1.3-2.9-6.5 6.3-.3z" ' +
      'fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    Object.assign(el.style, {
      position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none', display: 'none',
      filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.45))', transformOrigin: '4px 3px',
    });
    document.body.append(el);
    const place = (ev) => {
      el.style.display = 'block';
      el.style.translate = `${ev.clientX - 4}px ${ev.clientY - 3}px`;
    };
    window.addEventListener('pointermove', place, true);
    window.addEventListener('pointerdown', (ev) => { place(ev); el.style.scale = '0.88'; }, true);
    window.addEventListener('pointerup', () => { el.style.scale = '1'; }, true);
  });
}

/** Client-space tip of the drawn pointer (where the last mouse event put it). */
export async function fakeCursorPosition(page) {
  return page.evaluate(() => {
    const t = document.getElementById('demo-cursor').style.translate.split(' ').map(parseFloat);
    return { x: t[0] + 4, y: t[1] + 3 };
  });
}

/** Device-pixel viewport screenshot halved to the output size (a raw CDP session would reset the DPR emulation). */
export async function captureHalf(page) {
  return downsample2x(decodePng(await page.screenshot({ scale: 'device', caret: 'initial' })));
}
