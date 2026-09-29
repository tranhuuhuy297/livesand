// Shared types for every LiveSand module. Units: 1 world unit = 1 grid cell; heights and water depths use the same unit.

export interface GridSize {
  width: number;
  height: number;
}

/** Default simulation grid: 4:3 like a typical sandbox (e.g. 100 x 75 cm). */
export const DEFAULT_GRID: GridSize = { width: 256, height: 192 };

export interface Vec2 {
  x: number;
  y: number;
}

/** Corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Vec2, Vec2, Vec2, Vec2];

/** Row-major 3x3 matrix, length 9. */
export type Mat3 = Float64Array;

/** true = open edge (water drains out, e.g. the sea); false = wall. North is row 0. */
export interface EdgeFlags {
  north: boolean;
  east: boolean;
  south: boolean;
  west: boolean;
}

/** 'burning': molten lava over the village (it burns down within seconds). */
export type VillageState = 'safe' | 'flooding' | 'burning' | 'lost';

/** What renderers need to draw a village on the terrain (grid coordinates). */
export interface VillageMarker {
  x: number;
  y: number;
  radius: number;
  state: VillageState;
  /** 0..1 progress towards being lost. */
  flood01: number;
}

/**
 * GPU storage buffers owned by WaterSimPipes and read by renderers/probes.
 * Layout: index = y * width + x.
 * terrain/water/emission: array<f32>; flux: array<vec4<f32>> with (left, right, north(y-1), south(y+1)) outflow.
 */
export interface SimGpuBuffers {
  terrain: GPUBuffer;
  water: GPUBuffer;
  flux: GPUBuffer;
  emission: GPUBuffer;
  grid: GridSize;
}

/** Maps grid coords + height to 3D world space used by the perspective renderer and ray picker (y is up). */
export function gridToWorld(grid: GridSize, x: number, y: number, h: number, verticalScale: number): [number, number, number] {
  return [x - grid.width / 2, h * verticalScale, y - grid.height / 2];
}

/** Inverse of gridToWorld for the horizontal plane. */
export function worldToGrid(grid: GridSize, wx: number, wz: number): Vec2 {
  return { x: wx + grid.width / 2, y: wz + grid.height / 2 };
}

export interface Ray {
  origin: [number, number, number];
  dir: [number, number, number];
}
