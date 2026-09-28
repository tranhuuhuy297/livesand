# LSD1 depth protocol

How depth frames travel from a depth camera (the iPhone app, `livesand fake-source`, or your own bridge) through the
relay to the browser. Writing a bridge for another camera (Kinect, Orbbec, RealSense) only needs this page.

Source of truth: `src/core/depth-frame-protocol.ts` (browser decoder), `server/depth-frame-encoder.ts` (Node encoder,
byte-for-byte twin), `ios/LiveSandDepth/Sources/DepthFrameEncoder.swift` (iPhone encoder).

## Frame layout

One WebSocket **binary** message = one frame. All numbers little-endian.

| Offset | Type | Field | Value |
| --- | --- | --- | --- |
| 0 | u32 | magic | `0x3144534C` (bytes `L` `S` `D` `1`) |
| 4 | u16 | version | `1` |
| 6 | u16 | format | `1` = float32 metres, `2` = uint16 millimetres |
| 8 | u32 | width | pixels per row (iPhone LiDAR: 256) |
| 12 | u32 | height | rows (iPhone LiDAR: 192) |
| 16 | f64 | timestampMs | capture time, Unix epoch milliseconds |
| 24 | u32 | frameIndex | per-session counter, wraps at 2^32 |
| 28 | payload | depth | `width × height` samples, row-major, row 0 = top of the image |

Header size is 28 bytes; the message must be exactly `28 + width × height × bytesPerSample` bytes
(4 for format 1, 2 for format 2).

### Depth values

- **Format 2 (uint16 mm)** is what the iPhone sends: a 256 × 192 frame is 98,332 bytes. `0` = invalid.
- **Format 1 (float32 m)**: `0`, negative, NaN and infinity all decode as invalid.
- Mark a pixel invalid rather than guessing: missing samples, out-of-range readings, low sensor confidence
  (the iPhone app drops ARKit confidence *low*). Invalid pixels are skipped; the terrain keeps its last value there.
- Depth is the distance from the camera along its viewing axis, in the camera's own image orientation. Do not rotate or
  mirror: the browser's four-corner calibration maps any orientation onto the sandbox.

### Size limits

Frames are rejected (never allocated) when `width` or `height` exceeds **4096** or `width × height` exceeds
**1,048,576** pixels. The relay's source socket accepts messages up to 4 MiB + 28 bytes.

## Relay endpoints

`npx livesand` listens on port **8787** by default (`--port` to change, `--host` to bind one interface).

| Endpoint | Who | Purpose |
| --- | --- | --- |
| `ws://<host>:8787/ws?role=source` | Depth camera | Sends LSD1 frames |
| `ws://<host>:8787/ws?role=viewer` | Browser | Receives the frames |
| `GET /pairing.json` | Browser | `{ sourceUrls, viewerUrls, port, warning? }` for the pairing QR code |
| `GET /` and static files | Browser | The built web app (`dist/`) |

Rules the relay enforces:

- **One source at a time.** When a new source connects, the previous one is closed with code **4001**
  ("replaced by a newer depth source"). Treat 4001 as final: stop, do not reconnect in a loop.
- **Only valid frames reach viewers.** Anything that is not a well-formed LSD1 frame within the limits is dropped.
- **Slow viewers skip frames** (more than 4 MiB buffered) instead of queueing them: the newest depth always wins.
- **Connection caps:** 4 source sockets (including ones still closing), 16 viewers, 8 per remote address. Extra
  upgrades get HTTP 503; a handshake that races past the check is closed with **1013**.
- **Origins.** Requests without an `Origin` header (native apps, CLI tools) are accepted. Browser pages must be on
  loopback, on the relay's own LAN address, listed with `--allow-origin <origin>`, or (viewers only) on `*.github.io`.
  Everything else gets 403.
- A bad or missing `role` is closed with **1008**.

## Control messages

The relay sends JSON **text** messages; binary messages are always frames.

| Direction | Message | Meaning |
| --- | --- | --- |
| relay → source | `{"type":"hello","role":"source","acks":true}` | Sent on connect: this relay acknowledges frames |
| relay → source | `{"type":"ack","frameIndex":N}` | One per binary message received (`frameIndex` omitted if the message was not a valid frame) |
| relay → viewer | `{"type":"status","sources":S,"viewers":V}` | On every connect/disconnect and every 5 s as a keepalive |

The relay pings every peer every 15 s and drops those that did not answer the previous ping. Browsers cannot see
pings, so the web app treats 15 s without any message as a dead link and reconnects.

### Flow control for sources

Send at most **two frames that have not been acknowledged yet**; when the window is full, drop the new frame instead of
queueing it (stale depth is worse than missing depth). If the relay never sends `hello`, fall back to one frame in
flight, paced on send completion. The iPhone app does exactly this (`FrameSendWindow.swift`).

## Writing a bridge

1. Grab depth frames from your camera in metres or millimetres.
2. Encode each as LSD1 (the header above plus the payload) and send it as one binary WebSocket message to
   `ws://<relay>:8787/ws?role=source`. Do not send an `Origin` header.
3. Follow the flow control above; reconnect with backoff on ordinary disconnects, stop on 4001.

A minimal Node sender, using the encoder from this repo:

```js
import { WebSocket } from 'ws';
import { DepthFormat, encodeDepthFrame } from 'livesand/dist-server/depth-frame-encoder.js';

const ws = new WebSocket('ws://192.168.1.20:8787/ws?role=source');
let frameIndex = 0;
ws.on('open', () => {
  const mm = new Uint16Array(256 * 192).fill(1000); // flat sand 1 m below the camera
  ws.send(encodeDepthFrame({ width: 256, height: 192, format: DepthFormat.Uint16Millimeters, timestampMs: Date.now(), frameIndex: frameIndex++, data: mm }));
});
```

`server/fake-depth-source.ts` is a complete reference source (synthetic sand, a moving hand, reconnects, fatal close
handling).
