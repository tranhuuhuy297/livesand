# Project roadmap

## Done: 0.2.0 "Real places + Volcano" (September 2026)

| Feature | Status |
| --- | --- |
| GPU lava simulation (viscous pipes, cooling into rock, quench and steam) coupled to the water | Done |
| Lava tool (key 6) in free play, on real places and on volcano levels | Done |
| Mount Ember volcano level (eruption waves, burning villages, "Lava close" warning, hint line) | Done |
| Eight baked real places and live terrain for any latitude/longitude | Done |
| "Your hometown…": geolocation, place search, coordinates; place card with "Flood it" | Done |
| Hội An Floods challenge level on real terrain | Done |
| `?place=` / `&name=` links and a Share button | Done |
| README (English + Chinese), docs, demo media (volcano, Hạ Long, Hội An, lava GIF) | Done |

## Done: 0.1.0 MVP (September 2026)

| Phase | Status |
| --- | --- |
| Module contracts (types, exact APIs) | Done |
| Core, GPU water sim, renderers, game and input, relay, iOS app | Done |
| App integration (virtual + projector mode), build | Done |
| E2E tests in headless Chromium WebGPU | Done |
| Code review and fixes (TypeScript, Swift, relay security) | Done |
| README (English + Chinese), docs, CI and Pages workflows, demo media | Done |

## Launch checklist

- [x] Fix the projector-mode calibration wizard inside the app (namespaced `lsp-*` classes, layer order, e2e test).
- [ ] Enable GitHub Pages (Settings → Pages → Source: GitHub Actions) and check the demo URL and social preview.
- [ ] Publish the `livesand` package to npm so `npx livesand` works.
- [ ] Run the full setup on real hardware (iPhone + projector + sand) and tune `spatialSigma` on real sand.
- [ ] Record a short clip of a physical sandbox for the README.
- [ ] 0.2: check the real-place links and "Your hometown…" on the hosted demo (tiles and place search from GitHub
      Pages, phone share sheet).

## Next

- [ ] TestFlight / App Store build of LiveSand Depth.
- [ ] Depth camera bridges speaking LSD1: Orbbec, Intel RealSense, Kinect.
- [ ] Optional per-run pairing token for the relay (security vs re-scanning the QR code after each restart).
- [ ] Erosion: water that carries and deposits sand (the virtual-pipes paper covers it).
- [ ] Lava on real sand: the lava sim in projector mode.
- [ ] Real places: tune the sea-versus-basin heuristic on more coasts, make "Flood it" threaten towns that stay dry
      idle (Đà Nẵng, Quy Nhơn, New Orleans), and add more challenge levels on real terrain.
- [ ] Lesson plans for teachers: watersheds, contour maps, flood planning, volcanoes.
- [ ] More levels and a level editor with shareable level links.
