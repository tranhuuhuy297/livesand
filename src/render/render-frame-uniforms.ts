// CPU side of the shared Frame uniform block + bind group helpers used by both renderers.
import type { GridSize, SimGpuBuffers, VillageMarker, VillageState } from '../core/types';
import type { RenderStyle } from './shading-common-wgsl';
import type { LavaBindings } from './lava-source-binding';

/** Structural GpuContext subset renderers need (keeps render/ independent of gpu/ module wiring). */
export interface RendererGpu {
  readonly device: GPUDevice;
  readonly format: GPUTextureFormat;
}

/** Structural WaterSimPipes subset renderers read: grid size and the storage buffers. */
export interface RendererSimSource {
  readonly grid: GridSize;
  readonly buffers: SimGpuBuffers;
}

export interface FrameView {
  viewProj: Float32Array;
  invViewProj: Float32Array;
  eye: readonly [number, number, number];
  viewportWidth: number;
  viewportHeight: number;
  fogStart: number;
  fogDensity: number;
  baseY: number;
}

/** Spring marker drawn as expanding ripples (grid coordinates). */
export interface SourceMarker {
  x: number;
  y: number;
  radius: number;
}

export const MAX_VILLAGES = 16;
export const MAX_SOURCES = 8;
export const FRAME_UNIFORM_FLOATS = 220;
export const FRAME_UNIFORM_BYTES = FRAME_UNIFORM_FLOATS * 4;
/** Shader time wraps so f32 time (and everything animated by it) keeps full precision on all-day exhibits. */
export const SHADER_TIME_WRAP_SEC = 1200;

// Float offsets matching struct Frame in sim-sampling-shaders.ts.
const VIEW_PROJ = 0;
const INV_VIEW_PROJ = 16;
const EYE = 32;
const GRID = 36;
const HEIGHT_STYLE = 40;
const MISC = 44;
const VIEWPORT = 48;
const EFFECTS = 52;
const VILLAGES = 56;
const VILLAGE_INFO = VILLAGES + MAX_VILLAGES * 4;
const SOURCES = VILLAGE_INFO + MAX_VILLAGES * 4;
const ATMOSPHERE = SOURCES + MAX_SOURCES * 4;

// Burning sits inside flooding's (0.5, 1.5) band so it shares the pulse and progress arc; only its colour differs.
const STATE_CODE: Record<VillageState, number> = { safe: 0, flooding: 1, burning: 1.25, lost: 2 };
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** Copies at most MAX_VILLAGES markers, dropping non-finite ones that would poison the shader loop. */
export function sanitizeVillages(markers: readonly VillageMarker[]): VillageMarker[] {
  return markers
    .filter((m) => Number.isFinite(m.x) && Number.isFinite(m.y) && Number.isFinite(m.radius) && m.radius > 0)
    .slice(0, MAX_VILLAGES)
    .map((m) => ({ ...m, flood01: Number.isFinite(m.flood01) ? Math.min(1, Math.max(0, m.flood01)) : 0 }));
}

/** Copies at most MAX_SOURCES finite spring markers. */
export function sanitizeSources(markers: readonly SourceMarker[]): SourceMarker[] {
  return markers.filter((m) => Number.isFinite(m.x) && Number.isFinite(m.y) && Number.isFinite(m.radius) && m.radius > 0).slice(0, MAX_SOURCES);
}

/** Per-frame extras that are not part of the render style: springs and the quarter-turned 2D map. */
export interface FrameExtras {
  sources: readonly SourceMarker[];
  rotated: boolean;
}

export function packFrameUniforms(
  out: Float32Array,
  grid: GridSize,
  style: RenderStyle,
  villages: readonly VillageMarker[],
  view: FrameView | null,
  extras: FrameExtras = { sources: [], rotated: false },
): Float32Array {
  out.fill(0);
  out.set(view ? view.viewProj : IDENTITY, VIEW_PROJ);
  out.set(view ? view.invViewProj : IDENTITY, INV_VIEW_PROJ);
  if (view) out.set(view.eye, EYE);
  out.set([grid.width, grid.height, 1 / grid.width, 1 / grid.height], GRID);
  const maxHeight = style.maxHeight > style.minHeight ? style.maxHeight : style.minHeight + 1;
  out.set([style.minHeight, maxHeight, style.contourInterval, style.verticalScale], HEIGHT_STYLE);
  const count = Math.min(villages.length, MAX_VILLAGES);
  const time = Number.isFinite(style.timeSec) ? ((style.timeSec % SHADER_TIME_WRAP_SEC) + SHADER_TIME_WRAP_SEC) % SHADER_TIME_WRAP_SEC : 0;
  out.set([style.showHillshade ? 1 : 0, time, count, view ? view.baseY : 0], MISC);
  if (view) out.set([view.viewportWidth, view.viewportHeight, view.fogStart, view.fogDensity], VIEWPORT);
  const sources = Math.min(extras.sources.length, MAX_SOURCES);
  const storm = Math.min(1, Math.max(0, style.stormLevel));
  out.set([style.seaLevel, storm, sources, extras.rotated ? 1 : 0], EFFECTS);
  out[ATMOSPHERE] = Number.isFinite(style.ashLevel) ? Math.min(1, Math.max(0, style.ashLevel)) : 0;
  for (let i = 0; i < sources; i++) {
    const s = extras.sources[i];
    out.set([s.x, s.y, s.radius, 0], SOURCES + i * 4);
  }
  for (let i = 0; i < count; i++) {
    const v = villages[i];
    out.set([v.x, v.y, v.radius, STATE_CODE[v.state] ?? 0], VILLAGES + i * 4);
    out[VILLAGE_INFO + i * 4] = v.flood01;
  }
  return out;
}

export function createFrameBindGroupLayout(device: GPUDevice, label: string): GPUBindGroupLayout {
  const visibility = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
  const storage = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility, buffer: { type: 'read-only-storage' } });
  return device.createBindGroupLayout({
    label,
    entries: [
      { binding: 0, visibility, buffer: { type: 'uniform', minBindingSize: FRAME_UNIFORM_BYTES } },
      storage(1),
      storage(2),
      storage(3),
      storage(4),
      storage(5),
      storage(6),
      storage(7),
      // Fragment only: the vertex stage stays within the 8 storage buffers every WebGPU device guarantees.
      { binding: 8, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  });
}

export function createFrameBindGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  uniform: GPUBuffer,
  buffers: SimGpuBuffers,
  lava: LavaBindings,
  label: string,
): GPUBindGroup {
  return device.createBindGroup({
    label,
    layout,
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: { buffer: buffers.terrain } },
      { binding: 2, resource: { buffer: buffers.water } },
      { binding: 3, resource: { buffer: buffers.flux } },
      { binding: 4, resource: { buffer: buffers.emission } },
      { binding: 5, resource: { buffer: lava.lava } },
      { binding: 6, resource: { buffer: lava.rock } },
      { binding: 7, resource: { buffer: lava.fx } },
      { binding: 8, resource: { buffer: lava.emission } },
    ],
  });
}

/** Creates a shader module and prints WGSL errors with line numbers (validation errors also reach device handlers). */
export function createCheckedShaderModule(device: GPUDevice, label: string, code: string): GPUShaderModule {
  const module = device.createShaderModule({ label, code });
  module
    .getCompilationInfo()
    .then((info) => {
      for (const m of info.messages) {
        if (m.type === 'error') console.error(`[${label}] WGSL ${m.lineNum}:${m.linePos} ${m.message}`);
      }
    })
    .catch(() => undefined);
  return module;
}

export function assertGridMatches(sim: RendererSimSource): void {
  const { grid, buffers } = sim;
  if (!(grid.width >= 2 && grid.height >= 2)) throw new Error(`Renderer needs a grid of at least 2x2, got ${grid.width}x${grid.height}`);
  const cells = grid.width * grid.height;
  if (buffers.terrain.size < cells * 4 || buffers.water.size < cells * 4 || buffers.emission.size < cells * 4 || buffers.flux.size < cells * 16) {
    throw new Error('Sim buffers are smaller than the grid they claim to cover');
  }
}
