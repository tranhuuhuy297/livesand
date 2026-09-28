// Assembles the single WGSL module holding every 3D entry point (sky, terrain, houses, water).
import { SHADING_COMMON_WGSL } from './shading-common-wgsl';
import { PERSPECTIVE_SKY_LIGHTING_WGSL } from './perspective-sky-lighting-shaders';
import { PERSPECTIVE_TERRAIN_WGSL } from './perspective-terrain-shaders';
import { PERSPECTIVE_WATER_WGSL } from './perspective-water-shaders';

export const PERSPECTIVE_3D_WGSL = [
  SHADING_COMMON_WGSL,
  PERSPECTIVE_SKY_LIGHTING_WGSL,
  PERSPECTIVE_TERRAIN_WGSL,
  PERSPECTIVE_WATER_WGSL,
].join('\n');
