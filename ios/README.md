# LiveSand Depth (iOS)

A tiny SwiftUI app that turns a LiDAR iPhone or iPad into the depth camera of a LiveSand AR sandbox.
It reads ARKit scene depth (`smoothedSceneDepth` when available, else `sceneDepth`), converts it to
16-bit millimeters and streams it at ~30 fps over a WebSocket to the LiveSand relay running on your computer
(`npx livesand`). The browser turns those frames into terrain and the projector paints water on the sand.

## Requirements

- iPhone 12 Pro / 13 Pro / 14 Pro / 15 Pro / 16 Pro (or newer Pro), or iPad Pro 2020 or newer: anything with a **LiDAR scanner**.
- iOS / iPadOS 16 or newer.
- A Mac with Xcode 15 or newer and [XcodeGen](https://github.com/yonaskolb/XcodeGen).
- A free Apple ID is enough to install on your own device (a "Personal Team").

## Build and install

```bash
brew install xcodegen
cd ios/LiveSandDepth
xcodegen generate          # creates LiveSandDepth.xcodeproj from project.yml (git-ignored)
open LiveSandDepth.xcodeproj
```

In Xcode:

1. Select the **LiveSandDepth** target, open **Signing & Capabilities**, tick *Automatically manage signing*
   and pick your **Personal Team**. If Xcode says the bundle ID is taken, change it to something unique,
   e.g. `io.livesand.depth.yourname`.
2. Plug in the phone, select it as the run destination and press **Run** (⌘R).
3. First launch only: on the phone open **Settings › General › VPN & Device Management**, trust your developer
   certificate, then start the app again. Free-team installs expire after 7 days; just run again from Xcode.

Unit tests (wire format, URL parsing, flow control): select an iOS Simulator and press ⌘U, or
`xcodebuild test -scheme LiveSandDepth -destination 'platform=iOS Simulator,name=iPhone 15'`.

## Use

1. On your computer, on the same Wi-Fi network as the phone, run `npx livesand`. It prints the web app URL
   and the phone's source URL (`ws://<computer-ip>:8787/ws?role=source`).
2. Open the web app, switch to projector mode and open the **Connect iPhone** panel: it shows a pairing QR code.
3. In LiveSand Depth tap **Scan pairing QR code** and point the camera at it (or type the source URL by hand;
   a bare `192.168.1.20:8787`, or just `192.168.1.20` for the default port 8787, works too). The URL is remembered
   for next time.
4. Tap **Start streaming**. Allow **Camera** and **Local Network** access when iOS asks.
   The status shows *Connected*, the frame rate, frames sent and frames dropped.
5. Mount the phone (below) and calibrate the four sandbox corners in the browser.

The screen stays awake while streaming. Keep the app in the foreground: iOS pauses the camera in the background.

## Mounting tips

- Put the phone **1 to 1.5 m above the sand, camera pointing straight down**, roughly above the center of the box.
  LiDAR is most accurate within ~2 m; much closer and the box will not fit in the ~60° field of view.
- Align the phone's long edge with the box's long edge so the 4:3 depth image covers the 4:3 sandbox.
- Use a rigid mount (camera arm, microphone boom, shelf bracket). Any wobble shows up as terrain noise.
- Keep the phone on a charger and out of direct projector heat; long sessions make it warm.
  If iOS throttles it, the frame rate drops but streaming continues.

## What is sent

Every WebSocket binary message is one `LSD1` frame, little-endian, byte-for-byte the format decoded by
`src/core/depth-frame-protocol.ts`:

| Offset | Type | Value |
| --- | --- | --- |
| 0 | u32 | magic `0x3144534C` (bytes `L` `S` `D` `1`) |
| 4 | u16 | version `1` |
| 6 | u16 | format `2` = uint16 millimeters |
| 8 | u32 | width (256 on current LiDAR devices) |
| 12 | u32 | height (192) |
| 16 | f64 | capture time, Unix epoch milliseconds |
| 24 | u32 | frame index (per streaming session, wraps at 2^32) |
| 28 | u16 × width × height | depth in mm, row-major; `0` = invalid (NaN, ≤ 0, > 65.535 m, or ARKit confidence *low*) |

**Orientation:** frames are sent exactly as the sensor produces them: the camera's native landscape image,
i.e. what the back camera sees with the device held in landscape with the Lightning/USB-C port on the **right**
(`UIInterfaceOrientation.landscapeRight`). Row 0 is the top edge of that image. The app does not rotate or
mirror anything; the browser's 4-corner calibration maps any phone rotation onto the sandbox.

Flow control: the relay acknowledges every frame it receives, and at most two frames may be unacknowledged; a new
frame is dropped (shown as *frames dropped*) instead of queueing behind them. Pacing on relay acks rather than on
local send completion matters because iOS reports a send as done once the bytes sit in the kernel buffer, which on
weak Wi-Fi would hide seconds of latency. (Against an older relay without acks the app falls back to one frame in
flight.) Dropped connections are retried with exponential backoff (0.5 s doubling to 10 s). A 256×192 frame is
~98 KB, so 30 fps needs ~24 Mbit/s of Wi-Fi.

The relay takes one depth source at a time: when another phone (or `npx livesand fake-source`) connects, the older
source is told it was replaced and stops, showing *Another depth source connected to the relay*; tap **Start**
to take over again. If ARKit itself fails (sensor or tracking error), the app keeps the relay connection and restarts
the camera after a short, growing delay, so an unattended projector recovers on its own.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "No LiDAR scanner on this device" | The app needs a LiDAR device (Pro iPhone 12+ or iPad Pro 2020+). Use virtual mode in the browser instead. |
| Stuck on *Retrying… Could not connect to the server* | Phone and computer must be on the same network (not a guest Wi-Fi with client isolation). Check that `npx livesand` is running, the IP in the URL is the computer's LAN IP, and the computer firewall allows incoming connections on port 8787. |
| *Retrying…* and no Local Network prompt ever appeared | Settings › Privacy & Security › Local Network › enable **LiveSand Depth**, then Start again. |
| "Camera access is off" | Tap **Open Settings** and enable Camera, or Settings › LiveSand Depth › Camera. |
| QR scanner says the code is not a relay link | Scan the QR from the **Connect iPhone** panel, not a web-page QR (public web pages, including the GitHub Pages demo without `?relay=`, are rejected). You can also type `ws://<ip>:8787/ws?role=source`. |
| *Another depth source connected to the relay and took over* | Something else (a second phone, or `npx livesand fake-source`) is streaming to the same relay. Stop it, then tap **Start streaming**. |
| Connected but the frame rate is low or many frames dropped | Weak Wi-Fi: move the router closer, prefer 5 GHz, or connect the computer by Ethernet. |
| Terrain looks noisy or tilted | Tighten the mount, point the phone straight down, then re-capture the flat-sand reference in the browser. |
| Hostnames like `mymac.lan` do not connect | iOS only allows plain `ws://` to IP addresses, `.local` names and single-label names. Use the IP printed by `npx livesand`. |

## Source layout

| File | Role |
| --- | --- |
| `Sources/LiveSandDepthApp.swift` | App entry point |
| `Sources/ContentView.swift` | SwiftUI screen: relay URL, scanner, start/stop, status |
| `Sources/DepthStreamController.swift` | `@MainActor` UI state, permissions, persistence (UserDefaults) |
| `Sources/LidarDepthStreamer.swift` | ARKit session on a serial queue, 30 fps throttle, stats |
| `Sources/DepthFrameEncoder.swift` | Float32 meters → uint16 mm + LSD1 header; drops low-confidence pixels |
| `Sources/RelayWebSocketClient.swift` | `URLSessionWebSocketTask`, ack-paced sends, keepalive, backoff |
| `Sources/FrameSendWindow.swift` | How many frames the relay has not acknowledged yet |
| `Sources/RelayControlMessage.swift` | Relay → phone text messages (hello, ack) and close codes |
| `Sources/RelayLinkPolicy.swift` | Link timeouts and reconnect backoff |
| `Sources/RelaySocketDelegateProxy.swift` | URLSession delegate that does not retain the client |
| `Sources/RelayConnectionState.swift` | Connection states shown in the UI |
| `Sources/RelayURLParser.swift` | Normalizes QR/typed text into the relay source URL |
| `Sources/QRCodeScannerView.swift` | AVFoundation QR scanner wrapped for SwiftUI |
| `Sources/CameraPermission.swift` | Camera authorization helper |
| `Tests/` | XCTest: wire-format bytes, confidence filtering, URL normalization, flow control |
