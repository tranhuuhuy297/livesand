# Changelog

All notable changes to LiveSand. Versions follow [Semantic Versioning](https://semver.org/).

## 0.1.0 — 2026-09-27

First public release.

### Added

- **Water simulation:** virtual-pipes shallow water in WebGPU compute shaders (256 × 192 grid, 50 ms steps), open and
  closed edges, springs, storm rain, brush rain and hand rain; GPU village depth probes with async readback.
- **Virtual mode:** Raise, Dig, Smooth, Flatten and Rain tools for mouse and touch (path-following strokes, pinch and
  orbit gestures); 2D topographic map (quarter-turned on portrait phones) and 3D orbit view with sky, box walls, houses,
  water shading and storm effects; speed 1×/2×/4×; shareable URLs.
- **Levels:** First Flood, Twin Towns and Flash Flood with pre-filled rivers, briefing cards, village status chips,
  stars and a result dialog with advice, level link and star prompts; free play with three landscapes and a rain toggle;
  a blank sandbox.
- **Projector mode:** relay client with pairing QR code, five-step calibration wizard (corners, flat sand, relief
  range, projector corner-pin, save) stored in the browser, depth-to-terrain pipeline (homography, EMA, hysteresis,
  Gaussian smoothing) and hand-hover rain.
- **Relay (`npx livesand`):** serves the app and relays LSD1 depth frames; `/pairing.json`; newest source wins; frame
  acknowledgements; keepalive status; origin policy (`--allow-origin`), payload and connection caps; LAN address
  ranking; `fake-source` command.
- **iOS app (LiveSand Depth):** ARKit LiDAR streaming at up to 30 fps as uint16 millimetres, confidence filtering,
  ack-paced flow control, QR pairing, reconnect and AR recovery.
- **WebGPU-unavailable page** with a preview image and browser tips.
- **Docs and tooling:** README in English and Chinese, docs (architecture, protocol, hardware guide, deployment),
  CI (typecheck, unit, build, e2e) and GitHub Pages workflows, `npm run demo:media` for the README GIF and screenshots.

### Fixed before release

- Projector-mode calibration wizard: its classes are namespaced (`lsp-*`) so HUD styles no longer capture its
  side column, and the physical UI layer sits above the projector status panel. Covered by an e2e test that completes
  the wizard through real clicks.

### Known issues

- The iOS app has not been published to the App Store; build it with Xcode.
