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

/** Runs `n` frames of `dt` seconds, then redraws the brush ring the live loop would have drawn. */
export async function step(page, n, dt) {
  await page.evaluate(([count, seconds]) => window.__livesand.debug.stepFrames(count, seconds), [n, dt]);
  await page.evaluate(() => {
    const app = window.__demoApp;
    if (!app) return;
    const { pointer } = app.input;
    app.cursor.update(app.geometry(), pointer.brushClient, app.tool, app.brushRadius, pointer.stroking);
  });
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

/** Device-pixel viewport screenshot halved to the output size (a raw CDP session would reset the DPR emulation). */
export async function captureHalf(page) {
  return downsample2x(decodePng(await page.screenshot({ scale: 'device', caret: 'initial' })));
}
