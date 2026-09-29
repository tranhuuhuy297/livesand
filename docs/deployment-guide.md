# Deployment guide

LiveSand ships three ways: the **hosted demo** (GitHub Pages, virtual mode), the **relay** (`npx livesand`, for real
sandboxes) and the **iOS app** (built from source with Xcode).

## Hosted demo on GitHub Pages

`.github/workflows/pages.yml` builds the web app with Vite and deploys `dist/` on every push to `main` (and on manual
runs from the Actions tab).

One-time setup:

1. Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main` (or run *Deploy demo to GitHub Pages* manually). The `github-pages` environment shows the URL,
   `https://<user>.github.io/livesand/`.

Notes:

- `vite.config.ts` uses `base: './'`, so the build works under any sub-path without changes.
- `index.html` hard-codes `og:url`, `og:image` and `twitter:image` as `https://tranhuuhuy297.github.io/livesand/...`.
  Social previews need absolute URLs; update them if the repository or domain changes.
- The hosted demo is virtual mode. Projector mode needs the local relay (an HTTPS page cannot reach `ws://` on your LAN).
- The built-in real places are copied from `public/places/` into `dist/places/` and fetched with relative URLs, so they
  work under any sub-path and behind the relay. Places outside the catalogue are fetched by the browser from
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/…` (elevation tiles) and `https://photon.komoot.io` (place
  search). If you serve the app with a Content Security Policy, allow both in `connect-src`.

### Other static hosts

`npm run build:web` and upload `dist/` anywhere (Netlify, Cloudflare Pages, your own server). To let such a copy talk to
a relay as a viewer, start the relay with `--allow-origin https://your.site`.

## Real places data

`npm run bake:places` downloads the AWS Terrain Tiles around each place in `src/game/real-places-catalog.ts` and writes
`public/places/<id>.bin` plus `manifest.json` (tile zoom, bounding box, elevation range and tile sources per place).
Tiles are cached in the system temp directory (`--cache <dir>`, or `--no-cache`); `-- --only hoi-an,hue` re-bakes a
few places. Commit the regenerated files: the app ships them and the credit shown for each map comes from the tile
sources stored in the file. Adding a place means adding it to the catalogue and baking it; the folder must stay under 1.5 MiB (the script
checks).

## CI

`.github/workflows/ci.yml` runs on pushes to `main`, pull requests and manual dispatch (Ubuntu, Node 22):
`npm ci` → `npm run typecheck` → `npm test` → `npm run build` → `npx playwright install --with-deps chromium` →
`npm run test:e2e`. The e2e suite runs WebGPU on SwiftShader, so no GPU runner is needed. On failure the
`e2e-screens/` and `test-results/` folders are uploaded as an artifact.

## The relay: `npx livesand`

Requires Node 20 or newer on the laptop next to the sandbox.

```bash
npx livesand                                   # app + relay on port 8787, all interfaces
npx livesand --port 9000                       # another port
npx livesand --host 192.168.1.20               # bind one interface
npx livesand --allow-origin https://your.site  # let a self-hosted copy of the app use this relay (repeatable)
npx livesand fake-source --url 192.168.1.20:8787 --fps 30   # synthetic depth, no phone needed
```

The banner prints the local URL, the projector URL for each LAN address and the phone's source URL. Allow incoming
connections on the port in the OS firewall. Binding to `127.0.0.1` prints a warning because the phone cannot reach it.

From a clone instead of npm: `npm ci && npm run build && npm start`.

### Publishing to npm

The package ships `dist/`, `dist-server/`, `README.md` and `LICENSE`; `bin.livesand` is `dist-server/cli.js`.

```bash
npm ci
npm run typecheck && npm test && npm run build
npm pack --dry-run      # check the file list: dist/, dist-server/, README.md, LICENSE, package.json
npm publish
```

Bump `version` in `package.json` and add a `docs/project-changelog.md` entry first.

## iOS app

Not on the App Store yet. Build and install it on your own device with Xcode 15+ and XcodeGen:

```bash
brew install xcodegen
cd ios/LiveSandDepth
xcodegen generate
open LiveSandDepth.xcodeproj
```

Select your (free) Personal Team under *Signing & Capabilities*, change the bundle ID if Xcode says it is taken, plug in
the phone and press Run. Free-team installs expire after 7 days; run again from Xcode. Full instructions and
troubleshooting: [ios/README.md](../ios/README.md).

## README media

`npm run demo:media` rebuilds the relay and re-records everything in `docs/assets/` (hero GIF, lava GIF, 2D/3D/
projector/calibration/volcano/Hạ Long/Hội An screenshots, setup illustration) in headless Chromium. It needs
Playwright's Chromium (`npx playwright install chromium`). On SwiftShader the original set takes about 5 minutes and
`volcano,places` about 10 (mostly the lava GIF). Use `-- --only gif` (or `volcano`, `places`, …) to redo some assets,
and `-- --out /tmp/livesand-media --samples /tmp/livesand-frames` to review the output and a few GIF frames before
overwriting `docs/assets/`. GIFs over 4 MB are rejected. Re-record after visual changes so the README matches the app.
`public/og-image.jpg` is separate and was captured once by hand.
