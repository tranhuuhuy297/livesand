# Codebase summary

TypeScript (strict) for the web app and relay, WGSL for the GPU, Swift for the iOS app. No UI framework, no game
engine. Runtime dependencies: `wgpu-matrix` (camera math), `qrcode` (pairing QR), `ws` (relay).

```
index.html                 app shell, Open Graph / Twitter card tags
public/og-image.jpg        social preview image (1200 x 630)
public/places/             baked real places: <id>.bin (LSP1, 96 KB each) + manifest.json
src/
  main.ts                  boot: URL params, WebGPU device, virtual or projector mode
  core/                    GPU-free math shared by browser, tests and (mirrored) server
  gpu/                     WebGPU device, water simulation, lava simulation, village probes
  render/                  2D/projector renderer, 3D renderer, WGSL shading library (water, lava), orbit camera
  game/                    levels, procedural terrains, real-place terrain, flood and lava rules, emission
  input/                   sculpt brushes, heightfield ray picking
  app/                     virtual/projector apps, HUD, level flow, place search, input wiring, session, debug API
  app/physical/            relay client, pairing panel, calibration wizard and storage, keystone
server/                    relay + CLI (npx livesand), fake depth source
ios/LiveSandDepth/         SwiftUI + ARKit LiDAR streamer (XcodeGen project.yml, XCTest)
tests/unit/                Vitest (Node)
tests/e2e/                 Playwright specs (headless Chromium, WebGPU on SwiftShader)
tests/gpu-harness/         standalone pages for the water sim, renderers and physical mode
scripts/                   record-demo-media.mjs + demo-media/ (README GIFs and screenshots), bake-real-places.mjs
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
| gpu | `lava-sim.ts`, `lava-sim-shaders.ts`, `lava-sim-thermal-shaders.ts` | Viscous lava pipes (yield stress), cooling into rock, quench and steam, terrain compose |
| gpu | `lava-sim-params.ts` | Lava parameters, defaults and validation; rheology constants shared with the CPU replica |
| render | `top-down-projector-renderer.ts` | Full-screen pass for the 2D map and the projector |
| render | `perspective-3d-renderer.ts` | Sky, terrain mesh, houses, water, 4× MSAA |
| render | `terrain-palette-shaders.ts`, `water-surface-shaders.ts` | Colormap, contours, hillshade; ripples, foam, rain rings |
| render | `lava-source-binding.ts`, `lava-fx-field-shaders.ts` | Lava/rock/emission bindings (zero buffers without lava) and the per-frame glow/steam/slope field |
| render | `lava-surface-shaders.ts`, `lava-perspective-shaders.ts` | Molten crust, basalt, glow, steam; 3D wall cut, steam billboards, glow haze |
| game | `level-definitions.ts`, `level-types.ts` | Level catalogue and data model (villages, springs, storm, eruption, hint, place) |
| game | `mount-ember-level.ts`, `volcano-terrain-layout.ts` | The volcano level and its cone, gully and old channel to the sea |
| game | `hoi-an-floods-level.ts` | Typhoon level on the baked Hội An terrain |
| game | `village-flood-game.ts` | Flooded and burned time, win/lose, stars |
| game | `real-places-catalog.ts`, `real-places.ts` | The eight baked places; loading baked files and live tiles |
| game | `real-place-tile-fetching.ts`, `place-terrain-resampling.ts`, `terrarium-decoding.ts` | Terrarium tiles → Web Mercator mosaic → grid metres |
| game | `real-place-height-mapping.ts`, `real-place-sea-detection.ts` | Metres → world units, sea vs below-sea basins, open edges |
| game | `real-place-elevation-cleanup.ts`, `real-place-hollow-filling.ts`, `terrain-flow-routing.ts` | Despiking and noise smoothing, shallow-hollow filling, D8 routing and river prefill |
| game | `real-place-levels.ts`, `real-place-storm-town.ts` | Real-place free play and the "Flood it" storm (town placement) |
| game | `real-place-attribution.ts`, `real-place-baked-format.ts` | Terrain credits per tile source; the LSP1 baked file format |
| game | `terrain-generators.ts`, `terrain-layouts.ts` | Deterministic landforms that route rivers into villages |
| input | `sculpt-tools.ts` | Raise / Dig / Smooth / Flatten along the drag path |
| app | `virtual-mode-app.ts`, `projector-mode-app.ts` | The two modes |
| app | `sandbox-session.ts`, `sandbox-gpu-scene.ts` | CPU session (fixed-step timing) and one GPU submission per frame |
| app | `scene-lava-layer.ts`, `session-lava-field.ts` | Lava sim + lava probes in the scene; crater and brush emission, lava activity |
| app | `virtual-level-flow.ts`, `place-terrain-loader.ts` | Level switching, real-map downloads (timeouts, aborts, cache), URL sync |
| app | `hud-any-place-dialog.ts`, `place-name-geocoder.ts`, `place-url-param.ts` | "Your hometown" dialog, Photon search/reverse lookup, `?place=` links |
| app | `hud-real-places-menu.ts`, `hud-place-card.ts`, `share-link.ts` | Real places menu, place card, share sheet or clipboard |
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
| `npm run bake:places` | Re-bakes `public/places/` from AWS Terrain Tiles (`-- --only hoi-an,hue`, tile cache in the temp dir) |

## Demo media pipeline (`scripts/`)

`record-demo-media.mjs` starts a Vite dev server on :5251 and headless Chromium with WebGPU on SwiftShader, then:

- `demo-media/hero-gif-recorder.mjs` plays level 1 in 3D through `window.__livesand.debug.stepFrames` with a drawn
  mouse pointer, and encodes a 720 px GIF (`delta-gif-encoder.mjs`: one palette per scene, unchanged pixels
  transparent, ordered dither for the result card);
- `demo-media/virtual-mode-screenshots.mjs` captures the 2D (Twin Towns) and 3D (Flash Flood) stills;
- `demo-media/volcano-and-real-place-screenshots.mjs` captures Mount Ember mid-eruption, Hạ Long Bay and Hội An Floods
  in 3D, and `demo-media/lava-gif-recorder.mjs` records the lava GIF (the pour, a Raise wall dragged along the level's
  hint line by `demo-media/mount-ember-wall-stroke.mjs`, the flow into the sea); the GIFs must stay under 4 MB;
- `demo-media/projector-and-calibration-shots.mjs` starts the real relay with
  `demo-media/synthetic-sandbox-depth-source.mjs` (a rotated box, sculpted sand and a hovering hand) and captures the
  calibration wizard (on the physical-mode harness page) and the projector view in the app;
- the setup illustration is exported from `src/app/real-sandbox-illustration.ts`.

Options: `--only gif,3d,2d,projector,calibration,setup,volcano,places` (`volcano`: `livesand-volcano.png` and
`livesand-lava.gif`; `places`: `livesand-ha-long.png` and `livesand-hoi-an.png`), `--samples <dir>` (writes a few GIF
frames as PNG) and `--out <dir>` (write somewhere other than `docs/assets/` to review first).
