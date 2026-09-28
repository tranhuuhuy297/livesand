# Codebase summary

TypeScript (strict) for the web app and relay, WGSL for the GPU, Swift for the iOS app. No UI framework, no game
engine. Runtime dependencies: `wgpu-matrix` (camera math), `qrcode` (pairing QR), `ws` (relay).

```
index.html                 app shell, Open Graph / Twitter card tags
public/og-image.jpg        social preview image (1200 x 630)
src/
  main.ts                  boot: URL params, WebGPU device, virtual or projector mode
  core/                    GPU-free math shared by browser, tests and (mirrored) server
  gpu/                     WebGPU device, water simulation, village probes
  render/                  2D/projector renderer, 3D renderer, WGSL shading library, orbit camera
  game/                    levels, procedural terrains, flood rules, emission (springs, rain)
  input/                   sculpt brushes, heightfield ray picking
  app/                     virtual/projector apps, HUD, input wiring, session, debug API
  app/physical/            relay client, pairing panel, calibration wizard and storage, keystone
server/                    relay + CLI (npx livesand), fake depth source
ios/LiveSandDepth/         SwiftUI + ARKit LiDAR streamer (XcodeGen project.yml, XCTest)
tests/unit/                Vitest (Node)
tests/e2e/                 Playwright specs (headless Chromium, WebGPU on SwiftShader)
tests/gpu-harness/         standalone pages for the water sim, renderers and physical mode
scripts/                   record-demo-media.mjs + demo-media/ (README GIF and screenshots)
docs/                      these docs; docs/assets/ holds README media
.github/                   CI and GitHub Pages workflows, issue and PR templates
```

## Key modules

| Area | Module | Role |
| --- | --- | --- |
| core | `types.ts` | Grid, quads, edge flags, shared GPU buffer shape, grid ↔ world mapping |
| core | `depth-frame-protocol.ts` | LSD1 encode/decode with size limits |
| core | `depth-terrain-processor.ts` | Depth frame → heightmap + hand mask (homography, EMA, hysteresis, blur) |
| core | `depth-calibration.ts`, `homography.ts` | Calibration shape/validation; homographies and CSS `matrix3d` |
| gpu | `water-sim-pipes.ts`, `water-sim-shaders.ts` | Virtual-pipes shallow water, two compute passes per step |
| gpu | `village-water-probe.ts` | GPU max-depth reduction per village, async readback |
| render | `top-down-projector-renderer.ts` | Full-screen pass for the 2D map and the projector |
| render | `perspective-3d-renderer.ts` | Sky, terrain mesh, houses, water, 4× MSAA |
| render | `terrain-palette-shaders.ts`, `water-surface-shaders.ts` | Colormap, contours, hillshade; ripples, foam, rain rings |
| game | `level-definitions.ts` | First Flood, Twin Towns, Flash Flood, free play, blank sand |
| game | `village-flood-game.ts` | Flooded-time rules, win/lose, stars |
| game | `terrain-generators.ts`, `terrain-layouts.ts` | Deterministic landforms that route rivers into villages |
| input | `sculpt-tools.ts` | Raise / Dig / Smooth / Flatten along the drag path |
| app | `virtual-mode-app.ts`, `projector-mode-app.ts` | The two modes |
| app | `sandbox-session.ts`, `sandbox-gpu-scene.ts` | CPU session (fixed-step timing) and one GPU submission per frame |
| app | `virtual-mode-hud.ts` + `hud-*.ts` | Top bar, village chips, tool dock, dialogs, storm overlay |
| app | `pointer-input-controller.ts` | Mouse/touch sculpting, orbit, pinch |
| app | `livesand-debug-api.ts` | `window.__livesand` for tests and scripted recording |
| physical | `physical-mode-controller.ts` | Relay connection, pairing, wizard, depth → terrain, keystone |
| physical | `calibration-wizard.ts` + `wizard-step-*.ts` | Corners, flat sand, relief, projector, save |
| server | `cli.ts`, `relay-server.ts`, `relay-websocket-hub.ts` | CLI, HTTP + WS relay, newest-source-wins hub |
| server | `relay-origin-policy.ts`, `relay-peer-limits.ts` | Browser-origin gate, connection caps |
| ios | `LidarDepthStreamer.swift`, `RelayWebSocketClient.swift` | ARKit capture, ack-paced streaming |

## Build outputs

- `npm run build:web` → `dist/` (Vite, relative `base: './'`, so the same build works on GitHub Pages and behind the
  relay). Projector mode is a separate lazy chunk.
- `npm run build:server` → `dist-server/` (tsc, NodeNext). `dist-server/cli.js` is the `livesand` bin and serves
  `../dist`.
- The npm package contains `dist/`, `dist-server/`, `README.md` and `LICENSE`.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on :5173 |
| `npm run typecheck` | `tsc --noEmit` for the web app/tests and the server |
| `npm test` | Vitest unit tests |
| `npm run build` | Web app + relay |
| `npm run test:e2e` | Playwright; `E2E_PORT` picks the dev-server port, `LIVESAND_E2E_GPU=1` uses the real GPU |
| `npm start` | `node dist-server/cli.js` (the relay on :8787) |
| `npm run demo:media` | Rebuilds the relay, then records `docs/assets/*` with Playwright |

## Demo media pipeline (`scripts/`)

`record-demo-media.mjs` starts a Vite dev server on :5251 and headless Chromium with WebGPU on SwiftShader, then:

- `demo-media/hero-gif-recorder.mjs` plays level 1 in 3D through `window.__livesand.debug.stepFrames` with a drawn
  mouse pointer, and encodes a 720 px GIF (`delta-gif-encoder.mjs`: one palette per scene, unchanged pixels
  transparent, ordered dither for the result card);
- `demo-media/virtual-mode-screenshots.mjs` captures the 2D (Twin Towns) and 3D (Flash Flood) stills;
- `demo-media/projector-and-calibration-shots.mjs` starts the real relay with
  `demo-media/synthetic-sandbox-depth-source.mjs` (a rotated box, sculpted sand and a hovering hand) and captures the
  calibration wizard (on the physical-mode harness page) and the projector view in the app;
- the setup illustration is exported from `src/app/real-sandbox-illustration.ts`.

Options: `--only gif,3d,2d,projector,calibration,setup` and `--samples <dir>` (writes a few GIF frames as PNG).
