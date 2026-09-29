// Assembles the WGSL module holding every 3D entry point (sky, terrain, houses, water; with lava also steam + glow sprites).
import { SHADING_COMMON_WGSL } from './shading-common-wgsl';
import { PERSPECTIVE_SKY_LIGHTING_WGSL } from './perspective-sky-lighting-shaders';
import { PERSPECTIVE_TERRAIN_WGSL } from './perspective-terrain-shaders';
import { PERSPECTIVE_WATER_WGSL } from './perspective-water-shaders';
import { lavaShadingWgsl } from './lava-shader-variants';
import { LAVA_PERSPECTIVE_WGSL } from './lava-perspective-shaders';
import { LAVA_GLOW_HAZE_WGSL } from './lava-glow-haze-shaders';

/** `lava` false stubs the lava layers out, so the lava-free pipelines compile as fast as before lava existed. */
export function perspective3DWgsl(lava: boolean): string {
  const lavaOnly = lava ? [LAVA_PERSPECTIVE_WGSL, LAVA_GLOW_HAZE_WGSL] : [];
  return [
    SHADING_COMMON_WGSL,
    lavaShadingWgsl(lava),
    PERSPECTIVE_SKY_LIGHTING_WGSL,
    PERSPECTIVE_TERRAIN_WGSL,
    PERSPECTIVE_WATER_WGSL,
    ...lavaOnly,
  ].join('\n');
}
