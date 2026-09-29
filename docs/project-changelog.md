# Changelog

All notable changes to LiveSand. Versions follow [Semantic Versioning](https://semver.org/).

## 0.2.0 — 2026-09-29

"Real places + Volcano": lava next to the water, a volcano level, and real terrain for any place on Earth.

### Added

- **Lava simulation:** a second virtual-pipes simulation on the GPU with strong damping and a yield stress (lava
  creeps, piles into lobes and stalls), cooling into rock, fast quenching where it touches water or the painted sea,
  and steam that boils water away. The water sim sees the ground as base terrain + rock + lava. Lava steps run only
  while lava is poured or still moving.
- **Lava tool (key 6):** pour lava under the cursor in free play, on real places and on volcano levels.
- **Mount Ember** (level 4): an eruption on the level clock sends lava down a gully into Emberton. Villages burn after
  3 s under molten lava, with a **Lava close** warning before that; a wall across the gully turns the flow into the
  sea, where it cools into new land. The level opens with Raise and a pulsing dashed hint line.
- **Lava rendering:** molten surface with a blackbody ramp and drifting crust plates, white-hot lava at the pour point,
  basalt rock, glow on nearby ground and a glow haze in 3D, steam plumes where lava meets water, the flow cut open at
  the box walls, and an ash-darkened sky while a volcano erupts.
- **Real places:** eight baked maps in `public/places/` (Hạ Long Bay, Hội An, Huế, Fansipan, Grand Canyon, Mount Fuji,
  Yosemite Valley, Mount St. Helens; `npm run bake:places`), and live AWS Terrain Tiles for any latitude/longitude.
  Heights are scaled to the sandbox (automatic vertical exaggeration, 9× on flat deltas), real coasts become a painted
  sea with open edges while basins below sea level stay land, DEM noise is smoothed, shallow hollows are filled, and
  15 s of rain are routed into the rivers at load. Real maps stay north-up; the terrain credit shows in the corner.
- **Your hometown…:** use your location (named by reverse geocoding), search a town by name (Photon, OpenStreetMap
  data) or type coordinates, with a map width of 2–100 km.
- **Place card** on real maps: the place's description, **Flood it** (a 60 s typhoon with your town on low, flat
  ground near the centre), **Make it rain**, **Pour lava**, and the place's challenge level where it has one.
- **Hội An Floods** (level 5): a typhoon swells the Thu Bồn on the real delta; raise a levee along the dashed line or
  dig a relief channel to keep the Old Town dry.
- **Links and sharing:** `?place=<id>` and `?place=<lat>,<lon>[,<widthKm>]&name=<label>`; a **Share** button that uses
  the system share sheet where there is one and copies the link otherwise.
- **Portrait phones:** made-up levels still turn the 2D map a quarter, now with a north arrow; the level menu stays on
  screen.
- **Docs and media:** Real places and Volcano sections in both READMEs, new screenshots (volcano, Hạ Long Bay, Hội An)
  and a lava GIF; `npm run demo:media -- --only volcano,places` and `--out <dir>` for review runs.

### Changed

- Five levels instead of three; free play gets the Lava tool.
- The result card appears 1.8 s after a level ends, docked in a corner without blurring the map, so the aftermath
  stays visible; "Copy level link" became **Share**.
- The elevation palette puts sea level at t = 0.28, so low coastal land reads green instead of cyan.
- The hero GIF was re-recorded with the new result card.

### Known issues

- Sea versus below-sea-level basin detection is a heuristic tuned on 40 real maps; close-ups of flat basin floors or
  unusual bathymetry can be misjudged, and Caspian coasts count as sea.
- In some towns (for example Đà Nẵng, Quy Nhơn, New Orleans) the **Flood it** storm does not reach the town even when
  the player does nothing, and the result says the town held.
- Place search depends on the free photon.komoot.io service (fair-use policy); searches only run on submit.
- Huế shows some thin water over low patches of the plain at load.
- Lava is virtual-mode only; projector mode replaces Mount Ember with blank sand.
- The iOS app has not been published to the App Store; build it with Xcode.

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
