# Project roadmap

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

## Next

- [ ] TestFlight / App Store build of LiveSand Depth.
- [ ] Depth camera bridges speaking LSD1: Orbbec, Intel RealSense, Kinect.
- [ ] Optional per-run pairing token for the relay (security vs re-scanning the QR code after each restart).
- [ ] Erosion: water that carries and deposits sand (the virtual-pipes paper covers it).
- [ ] Lava mode and other fluids.
- [ ] Lesson plans for teachers: watersheds, contour maps, flood planning.
- [ ] More levels and a level editor with shareable level links.
