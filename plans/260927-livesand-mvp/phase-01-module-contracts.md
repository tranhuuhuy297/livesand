# Phase 01 — Module contracts (MUST follow exactly)

Shared types: `src/core/types.ts` (GridSize, Vec2, Quad, Mat3, EdgeFlags, VillageMarker, SimGpuBuffers, gridToWorld, worldToGrid, Ray, DEFAULT_GRID). Do not edit it; if a type is missing, define it locally in your module.

Conventions: TypeScript strict, ESM, relative imports WITHOUT extensions in `src/` (bundler resolution) and WITH `.js` extensions in `server/` (NodeNext). kebab-case file names, each file < 200 lines (split if needed). One-line comments explaining *why*. Every module unit-testable in Node where it doesn't need GPU/DOM. Grid index = `y * width + x`, north = row 0.

## A. Core math + depth protocol (`src/core/`)
```ts
// homography.ts
export function computeHomography(src: Quad, dst: Quad): Mat3;          // maps src[i] -> dst[i]; throws on degenerate quads
export function applyHomography(h: Mat3, p: Vec2): Vec2;
export function invertMat3(m: Mat3): Mat3;                              // throws if singular
export function cornerPinCssTransform(width: number, height: number, quad: Quad): string;
//   CSS `matrix3d(...)` mapping an element's rect (0,0)-(width,height) onto `quad` (px); use with transform-origin: 0 0.

// depth-frame-protocol.ts  (wire format shared with server/ and the iOS app; little-endian)
//   offset 0 u32 magic 0x3144534C ("LSD1" bytes 'L','S','D','1'), 4 u16 version=1, 6 u16 format,
//   8 u32 width, 12 u32 height, 16 f64 timestampMs, 24 u32 frameIndex, 28.. payload (row-major, row 0 = top of image)
export const DEPTH_FRAME_MAGIC = 0x3144534c;
export const DEPTH_FRAME_HEADER_BYTES = 28;
export enum DepthFormat { Float32Meters = 1, Uint16Millimeters = 2 }   // invalid pixel = 0
export interface DepthFrame { width: number; height: number; timestampMs: number; frameIndex: number; depthMeters: Float32Array }
export interface EncodeDepthFrameInput { width: number; height: number; format: DepthFormat; timestampMs: number; frameIndex: number; data: Float32Array | Uint16Array }
export class DepthFrameDecodeError extends Error {}
export function encodeDepthFrame(input: EncodeDepthFrameInput): ArrayBuffer;
export function decodeDepthFrame(buf: ArrayBuffer | Uint8Array): DepthFrame;   // validates magic/version/size, converts to meters

// depth-terrain-processor.ts
export interface DepthCalibration {
  roiQuad: Quad;                     // sandbox corners in depth-image pixel coords (TL,TR,BR,BL) -> grid rect
  referenceDepth: Float32Array | null; // per grid cell depth (m) of flat sand; null => use referencePlaneMeters
  referencePlaneMeters: number;      // fallback flat-sand distance
  unitsPerMeter: number;             // world units (cells) per meter of relief, e.g. grid.width / boxWidthMeters
  minHeight: number; maxHeight: number; // clamp in world units
  handMarginMeters: number;          // pixels this far above maxHeight are a hand/object, not sand
  smoothing: number;                 // EMA factor 0..1 (fraction of new sample per frame)
  changeThreshold: number;           // world units; smaller deltas are ignored (noise hysteresis)
}
export function defaultDepthCalibration(grid: GridSize, depthWidth: number, depthHeight: number): DepthCalibration;
export class DepthTerrainProcessor {
  constructor(grid: GridSize, calibration: DepthCalibration);
  get calibration(): DepthCalibration;
  setCalibration(patch: Partial<DepthCalibration>): void;
  resampleDepth(frame: DepthFrame): Float32Array;          // per-cell depth (m) via inverse homography + bilinear, 0 = invalid
  captureReference(frame: DepthFrame): Float32Array;       // stores & returns resampled flat-sand depth
  process(frame: DepthFrame): { heights: Float32Array; handMask: Uint8Array; changed: boolean };
  //   heights persist across frames (EMA, hand/invalid cells keep last value); handMask 1 where a hand hovers.
}
```

## B. GPU water simulation (`src/gpu/`)
```ts
// gpu-context.ts
export class WebGpuUnavailableError extends Error {}
export interface GpuContext { adapter: GPUAdapter; device: GPUDevice; format: GPUTextureFormat }
export async function createGpuContext(): Promise<GpuContext>;   // throws WebGpuUnavailableError with a human message
export function configureCanvas(gpu: GpuContext, canvas: HTMLCanvasElement): GPUCanvasContext; // alphaMode 'opaque'

// water-sim-pipes.ts (+ water-sim-shaders.ts holding WGSL strings)
//   Virtual-pipes shallow water (Mei et al. 2007): pass 1 flux update (in place), pass 2 depth update (in place),
//   emission (units/s) added, evaporation, open edges drain (outflow to outside at terrain level), walls reflect.
export interface WaterSimParams {
  gravity: number;          // default 9.81
  damping: number;          // flux damping per step, default 0.995
  evaporationPerSec: number;// fraction/s, default 0.01
  dt: number;               // seconds per step, default 0.05 (stable for depth < ~10 units)
  openEdges: EdgeFlags;     // default all false
}
export class WaterSimPipes {
  constructor(device: GPUDevice, grid: GridSize, params?: Partial<WaterSimParams>);
  readonly grid: GridSize;
  readonly buffers: SimGpuBuffers;
  get params(): WaterSimParams;
  setParams(patch: Partial<WaterSimParams>): void;
  uploadTerrain(heights: Float32Array): void;
  uploadEmission(ratePerCell: Float32Array): void;
  uploadWater(depths: Float32Array): void;
  clearWater(): void;                                   // zero water + flux
  encodeSteps(encoder: GPUCommandEncoder, steps: number): void;
  readWater(): Promise<Float32Array>;                   // debug/tests (copies to MAP_READ buffer)
  destroy(): void;
}

// village-water-probe.ts — max water depth inside each probe circle, computed on GPU, read back without stalling
export interface WaterProbe { x: number; y: number; radius: number }
export class VillageWaterProbe {
  constructor(device: GPUDevice, sim: WaterSimPipes, maxProbes?: number /* 16 */);
  setProbes(probes: WaterProbe[]): void;
  encode(encoder: GPUCommandEncoder): void;             // no-op when readback in flight
  requestReadback(): void;                              // call after queue.submit
  latest(): Float32Array | null;                        // last completed values (one per probe)
  destroy(): void;
}
```

## C. Renderers (`src/render/`)
```ts
// shading-common-wgsl.ts — shared WGSL snippet strings: buffer bindings helpers, bilinear sampling from storage
//   buffers, AR-sandbox elevation colormap (deep blue -> green -> yellow -> brown -> white), contour lines (fwidth AA),
//   hillshade, water shading (depth-based, flow speed from flux => lighter/foam), village ring markers
//   (safe green / flooding pulsing orange / lost red), hand-rain speckle overlay.
export interface RenderStyle {
  minHeight: number; maxHeight: number;   // colormap range (world units)
  contourInterval: number;                // world units; 0 disables contours
  verticalScale: number;                  // 3D exaggeration
  showHillshade: boolean;
  timeSec: number;                        // animation
}
export const DEFAULT_RENDER_STYLE: RenderStyle;
// top-down-projector-renderer.ts — full-screen pass; grid stretched to canvas (projector keystone via CSS)
export class TopDownProjectorRenderer {
  constructor(gpu: GpuContext, sim: WaterSimPipes);
  setStyle(patch: Partial<RenderStyle>): void;
  setVillages(markers: VillageMarker[]): void;          // max 16
  render(encoder: GPUCommandEncoder, target: GPUTextureView): void;
  destroy(): void;
}
// perspective-3d-renderer.ts — heightfield mesh (terrain) + water surface (alpha) using gridToWorld mapping
export class Perspective3DRenderer {
  constructor(gpu: GpuContext, sim: WaterSimPipes);
  setStyle(patch: Partial<RenderStyle>): void;
  setVillages(markers: VillageMarker[]): void;
  setCamera(viewProjection: Float32Array, eye: [number, number, number]): void;
  render(encoder: GPUCommandEncoder, target: GPUTextureView, width: number, height: number): void; // manages depth texture
  destroy(): void;
}
// orbit-camera.ts (pure math, wgpu-matrix allowed)
export class OrbitCamera {
  constructor(grid: GridSize);
  yaw: number; pitch: number; distance: number; target: [number, number, number];
  rotate(dxRadians: number, dyRadians: number): void;   // clamps pitch to (5°, 89°)
  zoom(factor: number): void;                           // clamps distance
  eye(): [number, number, number];
  viewProjection(aspect: number): Float32Array;         // column-major mat4 for WGSL
  rayFromScreen(ndcX: number, ndcY: number, aspect: number): Ray;
}
```

## D. Game, terrain, input (`src/game/`, `src/input/`)
```ts
// terrain-generators.ts — deterministic (seeded) procedural terrains, heights in world units
export type TerrainKind = 'river-valley' | 'twin-valleys' | 'mountain-basin' | 'flat';
export interface TerrainRecipe { kind: TerrainKind; seed: number; relief?: number }
export function generateTerrain(grid: GridSize, recipe: TerrainRecipe): Float32Array;

// level-definitions.ts
export interface VillageSpec { u: number; v: number; radius: number; name: string }   // u,v normalized 0..1
export interface WaterSourceSpec { u: number; v: number; radius: number; rate: number } // rate: units/s per cell
export interface StormKeyframe { t: number; rain: number }                            // global rain units/s, linear interp
export interface LevelDefinition {
  id: string; name: string; tagline: string;
  recipe: TerrainRecipe; villages: VillageSpec[]; sources: WaterSourceSpec[];
  openEdges: EdgeFlags; durationSec: number; storm: StormKeyframe[];
  floodDepthThreshold: number; floodSecondsToLose: number;
}
export const LEVELS: LevelDefinition[];        // >= 3 hand-tuned levels, solvable by digging/levees
export const SANDBOX_LEVEL: LevelDefinition;   // free play: no villages, no timer
export function getLevel(id: string): LevelDefinition; // falls back to LEVELS[0]

// village-flood-game.ts
export type GamePhase = 'ready' | 'running' | 'won' | 'lost';
export interface VillageRuntime { spec: VillageSpec; x: number; y: number; radius: number; state: VillageState; floodedSec: number }
export class VillageFloodGame {
  constructor(level: LevelDefinition, grid: GridSize);
  readonly level: LevelDefinition;
  get phase(): GamePhase; get elapsedSec(): number; get villages(): readonly VillageRuntime[];
  start(): void; reset(): void;
  update(dtSec: number, villageMaxDepths: Float32Array | null): void;  // flood accumulation, win/lose
  currentRainRate(): number;                                           // storm curve at elapsed time
  markers(): VillageMarker[];
  probes(): WaterProbe[];
  summary(): { saved: number; total: number; stars: 0 | 1 | 2 | 3 };
}
export function buildEmissionField(
  grid: GridSize, sources: WaterSourceSpec[], globalRain: number,
  brushRain: Float32Array | null, handMask: Uint8Array | null, handRainRate: number,
): Float32Array;

// src/input/sculpt-tools.ts
export type SculptTool = 'raise' | 'lower' | 'smooth' | 'flatten' | 'rain';
export interface BrushSettings { radius: number; strength: number }   // strength: units/s at center
export function applySculptBrush(
  heights: Float32Array, grid: GridSize, cx: number, cy: number, tool: Exclude<SculptTool, 'rain'>,
  brush: BrushSettings, dtSec: number, bounds: { min: number; max: number }, flattenTarget?: number,
): boolean;  // true if anything changed; smooth falloff
export function paintRainBrush(field: Float32Array, grid: GridSize, cx: number, cy: number, radius: number, rate: number): void;
// src/input/heightfield-ray-picker.ts
export function pickHeightfield(heights: Float32Array, grid: GridSize, verticalScale: number, ray: Ray): Vec2 | null; // grid coords
```

## E. Relay server + fake source (`server/`, Node ESM, `.js` import suffixes)
```ts
// relay-server.ts
export interface RelayServerOptions { port: number; host?: string; staticDir?: string | null; log?: (msg: string) => void }
export interface RelayServer { port: number; close(): Promise<void>; stats(): { sources: number; viewers: number; framesRelayed: number } }
export function startRelayServer(opts: RelayServerOptions): Promise<RelayServer>;
//   WS path /ws?role=source|viewer. Binary frames from sources -> all viewers (drop for a viewer when bufferedAmount > 4MB).
//   Text JSON {type:'status'} broadcast to viewers on connect/disconnect: {type:'status', sources, viewers}.
//   GET /pairing.json -> { sourceUrls: string[] (ws://<lan-ip>:<port>/ws?role=source), viewerUrls: string[], port }.
//   GET static files from staticDir (index.html fallback, path traversal safe, correct MIME, no-cache for index).
// lan-addresses.ts
export function lanIPv4Addresses(): string[];           // non-internal IPv4, stable order
// fake-depth-source.ts
export interface FakeSourceOptions { url: string; fps?: number; width?: number; height?: number; log?: (m: string) => void }
export function startFakeDepthSource(opts: FakeSourceOptions): { stop(): void };
//   256x192 uint16 mm frames: flat sand at 1000 mm, slowly drifting mound + a "hand" blob at ~700 mm moving in a circle.
//   Imports encoding from ../src/core/depth-frame-protocol? NO (different module system) — implement a small encoder
//   in server/depth-frame-encoder.ts that matches the wire format byte-for-byte (tested against src decoder in unit tests).
// cli.ts (bin, shebang): `livesand [--port 8787] [--host 0.0.0.0]` serves ../dist + relay, prints LAN URLs;
//   `livesand fake-source [--url ws://localhost:8787/ws?role=source] [--fps 30]`.
```

## F. iOS depth streamer (`ios/LiveSandDepth/`)
SwiftUI app, iOS 16+, LiDAR devices. XcodeGen `project.yml`. ARKit `ARWorldTrackingConfiguration` with `frameSemantics = [.sceneDepth, .smoothedSceneDepth]` (prefer smoothed). Converts Float32 meters → UInt16 mm (invalid/NaN/>65 m → 0), encodes LSD1 header (same bytes as A), sends via `URLSessionWebSocketTask` to the relay source URL; at most one send in flight (drop frames otherwise); target 30 fps; auto-reconnect with backoff. QR scanner (AVFoundation) reads the source URL from the web app's pairing QR; manual URL entry fallback; URL persisted in UserDefaults. UI: status (connected/fps/frames sent), start/stop, keep screen awake. Files: `LiveSandDepthApp.swift`, `ContentView.swift`, `LidarDepthStreamer.swift`, `DepthFrameEncoder.swift`, `RelayWebSocketClient.swift`, `QRCodeScannerView.swift`, `project.yml`, `README.md`.

## G. App integration (`src/app/`, `src/main.ts`, `index.html`, `src/styles.css`) — phase 03
URL params: `?mode=virtual|projector` (default virtual), `?level=<id>|sandbox`, `?view=2d|3d`, `?relay=<ws url>`, `?debug=1`.
Exposes `window.__livesand = { ready: boolean, error?: string, debug: { readWater(): Promise<Float32Array>, getHeights(): Float32Array, stepFrames(n): Promise<void>, state(): object } }` for e2e tests.
