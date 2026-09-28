# Code standards

## Language and tooling

- **TypeScript, strict**, with `noUnusedLocals`, `noUnusedParameters` and `noFallthroughCasesInSwitch`
  (`tsconfig.json` for the app and tests, `tsconfig.server.json` for the relay). `npm run typecheck` must pass.
- **WGSL** lives in TypeScript template strings next to the code that packs its uniforms, so buffer layouts cannot
  drift apart (e.g. `water-sim-shaders.ts` exports both the shader and `packSimParams`).
- **No UI framework.** The HUD is small DOM built with tiny helpers (`hud-dom-helpers.ts`, `physical/dom-builder.ts`)
  and updated by hand from a per-frame snapshot.
- **Swift** for the iOS app, iOS 16+, no third-party packages.

## Files

- **kebab-case, long and descriptive**: a file name should say what it does (`village-water-probe-shaders.ts`,
  `relay-silence-watchdog.ts`). Swift files use PascalCase.
- **Keep files under about 200 lines.** Split by concern when a file grows (shaders, pipelines, renderer; wizard shell
  and one file per step).
- **One header comment per file**: one line saying what the module is for.

## Comments

- Short and dense: one line by default, two when the *why* needs it.
- Explain the reason, not the mechanics: `// Newest frame only: stale depth is worse than dropped depth`.
- Docstrings are one sentence and do not repeat the signature.
- No references to plans, phases, review findings or ticket codes in code, tests or file names; state the invariant.

## Units and conventions

- 1 world unit = 1 grid cell, for x, y, height and water depth.
- Grids are row-major, `index = y * width + x`, north = row 0.
- Quads are ordered top-left, top-right, bottom-right, bottom-left.
- Depth on the wire: metres or millimetres, `0` = invalid.

## Error handling

- Validate at boundaries and throw descriptive errors (`RangeError` / `TypeError` with the offending value): calibration,
  sim parameters, depth frames, CLI flags.
- Never show a blank page: WebGPU absence and fatal errors render a friendly screen and set `window.__livesand.error`.
- Network input is untrusted: size-check before allocating, drop malformed frames, cap connections.
- Anything the user can fix gets a message saying how (relay CLI listen errors, pairing fetch failures).

## Testing

- **Unit tests** (`tests/unit/*.test.ts`, Vitest in Node) cover everything that does not need a GPU: protocol, depth
  processing, homography, calibration storage, relay, sculpting, terrain, level balance (a CPU reference simulation),
  camera math. Keep GPU-free logic in GPU-free modules so it stays testable.
- **E2E tests** (`tests/e2e/*.spec.ts`, Playwright) run the real app in headless Chromium with WebGPU on SwiftShader and
  drive it through `window.__livesand.debug` (`stepFrames` makes time deterministic).
- Test names describe the scenario (`one quick swipe from the village to the sea saves the first level`).
- Do not weaken or skip a failing test to get green; fix the cause.

## Performance

- One command buffer per frame; the simulation never reads back to the CPU except the small village probe buffer,
  asynchronously.
- Re-upload terrain and emission only when they changed.
- Cap sim steps per frame (a slow frame drops simulated time) and the canvas pixel budget (2.8 M pixels).

## Commits and pull requests

- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
- Before pushing: `npm run typecheck && npm test && npm run build`, and `npm run test:e2e` for anything that touches
  rendering, input or the relay.
- Visual changes: attach a screenshot or GIF. If the README media is affected, re-run `npm run demo:media`.
- Never commit secrets, `.env` files or signing identities.
