# LiveSand MVP — plan

Goal: an AR sandbox that runs in a browser tab. Real sand + iPhone LiDAR + projector, or a virtual sandbox (mouse sculpting) that anyone can open on GitHub Pages. Objective: GitHub stars (demo-first, repo is the product).

Source of pick: `../../../plans/reports/brainstorm-260927-stars-first-report.md` (LiveSand: verifier 150-800★, median ~300).

## Phases
| # | Phase | Status |
|---|---|---|
| 01 | Module contracts (types + exact APIs) — `phase-01-module-contracts.md` | done |
| 02 | Parallel module implementation (core, gpu sim, renderers, game/input, relay server, iOS app) | done |
| 03 | App integration (`src/app/*`, `src/main.ts`, `index.html`) + build green | done |
| 04 | E2E tests in headless Chromium WebGPU + fix loop | done |
| 05 | Code review (TS + Swift) + fixes | done |
| 06 | README (EN + 中文), docs, CI + Pages workflow | done |

## Architecture (data flow)
```
 iPhone LiDAR app ──ws binary LSD1 frames──► relay server (Node, `npx livesand`) ──► browser viewer
 fake-depth-source (dev) ─┘                   serves dist/ + /pairing.json            │
                                                                                       ▼
 mouse sculpt (virtual) ──► CPU heightmap ◄── DepthTerrainProcessor (homography ROI, reference depth, EMA, hand mask)
                               │ upload when dirty
                               ▼
                 WaterSimPipes (WGSL compute: virtual pipes shallow water, emission = springs + storm + hand/brush rain)
                               │ storage buffers
               ┌───────────────┼──────────────────┐
     TopDownProjectorRenderer   Perspective3DRenderer   VillageWaterProbe (readback) ──► VillageFloodGame
     (projector, CSS corner-pin)  (orbit camera demo)                                     (save-the-village levels)
```

## Key decisions
- Raw WebGPU + WGSL (no three.js): compute + render share storage buffers; small bundle.
- Units: 1 world unit = 1 grid cell for x, y, height, water depth (physically consistent shallow water).
- Projector keystone = CSS `matrix3d` corner-pin on the canvas container (no shader warp).
- Relay server needed because GitHub Pages (https) cannot open `ws://` to a phone; physical mode runs from `npx livesand` on the laptop.
- iOS app: SwiftUI + ARKit `sceneDepth`, uint16 mm frames, XcodeGen `project.yml`. Not compilable on Linux CI — reviewed only.

## Success criteria
- `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e` all green.
- Virtual mode: sculpt, rain, water flows downhill, levels winnable/losable, 2D + 3D views.
- Physical mode e2e: relay + fake depth source → terrain updates, hand hover → rain.
