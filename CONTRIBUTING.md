# Contributing to LiveSand

Thanks for helping! Bug reports, new levels, depth-camera bridges, lesson ideas, docs fixes and photos of your own
sandbox are all welcome.

## Quick start

```bash
git clone https://github.com/tranhuuhuy297/livesand && cd livesand
npm ci
npm run dev            # http://localhost:5173
```

You need Node 20+ and a WebGPU browser (see the [README](README.md#browser-support)). For projector mode without a
phone: `npm run build && npm start` in one terminal, `node dist-server/cli.js fake-source` in another, then open
`http://localhost:8787/?mode=projector`.

## Before you open a pull request

```bash
npm run typecheck && npm test && npm run build
npm run test:e2e       # needs: npx playwright install chromium
```

- Keep pull requests focused, and describe what changed and why.
- Visual changes: attach a screenshot or GIF. If the README media changes, run `npm run demo:media`.
- Changes to the wire format, relay messages or controls: update `docs/depth-protocol.md` or the README.
- Follow [docs/code-standards.md](docs/code-standards.md): strict TypeScript, kebab-case file names, files under
  about 200 lines, short comments that explain why.
- Use conventional commit messages (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).

## Good first contributions

- **A depth-camera bridge** (Kinect, Orbbec, RealSense) that sends LSD1 frames to the relay. The whole protocol is on
  one page: [docs/depth-protocol.md](docs/depth-protocol.md).
- **A new level** in `src/game/level-definitions.ts`. `tests/unit/level-definitions.test.ts` plays levels with a CPU
  reference simulation, so add a test that the level can be lost idle and won with a reasonable move.
- **A lesson plan** for teachers using the sandbox (Markdown in `docs/`).
- **Translations** of the README.

## Where things live

[docs/codebase-summary.md](docs/codebase-summary.md) maps the folders and key modules;
[docs/system-architecture.md](docs/system-architecture.md) explains how the pieces fit together.

## iOS app

The app in `ios/LiveSandDepth` is built with Xcode and XcodeGen (`ios/README.md`). CI cannot build it; please run the
XCTest suite (⌘U) before sending Swift changes.

## Reporting bugs

Use the bug report template and include your browser, OS and GPU. For WebGPU problems, the text on the error screen
and anything red in the browser console (F12) help a lot.

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
