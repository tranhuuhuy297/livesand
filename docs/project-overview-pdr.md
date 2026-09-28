# Project overview and product requirements

## Summary

LiveSand is an augmented-reality sandbox that runs in a browser tab. A WebGPU shallow-water simulation flows over a
sculptable heightmap. In **virtual mode** you sculpt with a mouse or finger and play "save the village" flood levels in
a 2D map or a 3D view. In **projector mode** an iPhone's LiDAR scans real sand, the browser turns the depth into terrain,
and a projector paints elevation colours, contour lines and water back onto the sand; a hand held over the box makes it
rain.

Pitch: *the $10,000 museum AR sandbox, rebuilt with an old iPhone, a $120 projector and a browser tab.*

## Goals

1. **The first 60 seconds are obvious and delightful.** The hosted demo opens straight into level 1 with water already
   flowing; one swipe wins it.
2. **Real sand is achievable for a teacher or maker** with a LiDAR iPhone, a cheap projector, a laptop and about
   $200–300 of other parts, and one command (`npx livesand`).
3. **The repository is the product.** Clear README with a hero GIF, one-click demo, honest setup docs, green CI. Success
   is measured in GitHub stars and people who build one.

## Users

- Visitors to the GitHub page who want to play for a minute (virtual mode).
- Teachers, museums and maker spaces who want a physical AR sandbox for geography and hydrology lessons.
- Developers interested in WebGPU compute, real-time fluids or depth-camera projects.

## Functional requirements

| Area | Requirement |
| --- | --- |
| Simulation | Virtual-pipes shallow water on the GPU, 256 × 192 grid, fixed 50 ms steps, open (sea) or closed edges, springs, global rain, brush rain and hand rain. |
| Virtual mode | Raise, Dig, Smooth, Flatten and Rain tools with mouse and touch; 2D map and 3D orbit view; three levels, free play (three landscapes, rain toggle) and a blank box; speed 1×/2×/4×; shareable URLs; help and "real sandbox" dialogs. |
| Game | Villages flood when water stays above a threshold; lost after sustained flooding; win when any survive the clock; stars; win/lose dialog with advice, share and star prompts. |
| Projector mode | Relay connection with pairing QR; five-step calibration (corners, flat sand, relief range, projector keystone, save) stored in the browser; live depth to terrain with smoothing; hand detection makes rain; minimal status panel; levels playable on real sand. |
| Relay | `npx livesand` serves the app and relays LSD1 frames from one source to many viewers; `/pairing.json`; origin policy and connection caps; `fake-source` command for testing without a phone. |
| iOS app | Stream ARKit scene depth as uint16 mm LSD1 at up to 30 fps with ack-paced flow control; scan pairing QR; reconnect with backoff; recover from AR failures. |
| Fallbacks | A friendly page (with a preview image and tips) when WebGPU is unavailable; readable errors elsewhere. |

## Non-functional requirements

- **Performance:** interactive frame rates on integrated GPUs; at most 8 sim steps per frame per speed step; one GPU
  submission per frame; no synchronous GPU readbacks.
- **Portability:** Chrome/Edge 113+, Safari 26, Firefox 141+ (Windows); desktop and phone layouts (portrait and
  landscape).
- **Security:** the relay only accepts depth from native clients or allowed origins, validates frame sizes before
  allocating, caps connections and payloads. Only depth values leave the phone, and only on the LAN.
- **Accessibility:** keyboard shortcuts for every tool and view, focus management in dialogs, reduced-motion support.
- **Quality:** strict TypeScript, unit tests for GPU-free logic, e2e tests in headless WebGPU, files under ~200 lines.

## Out of scope for 0.1

- Sand erosion and deposition, other fluids.
- Depth cameras other than iPhone/iPad LiDAR (the protocol is open for bridges).
- App Store distribution of the iOS app (built from source with Xcode for now).
- Accounts, cloud features, multiplayer.

## Constraints and decisions

- Raw WebGPU + WGSL (no three.js): compute and rendering share storage buffers, and the bundle stays small.
- The relay exists because an HTTPS page (GitHub Pages) cannot open plain `ws://` connections to a phone on the LAN.
- Projector keystone is a CSS `matrix3d` corner-pin rather than a shader warp.
- The iOS app cannot be compiled on Linux CI; it has XCTest unit tests for the platform-independent parts.

## Status

Version 0.1.0 (September 2026): feature-complete MVP, green typecheck, unit, build and e2e suites. See
[project-roadmap.md](project-roadmap.md) for launch tasks and what comes next.
