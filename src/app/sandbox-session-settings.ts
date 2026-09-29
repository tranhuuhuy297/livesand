// Tunables and per-frame options of a sandbox session (kept apart so the session class stays focused on timing).
import type { LavaSimParams } from '../gpu/lava-sim-params';
import type { OrbitCamera } from '../render/orbit-camera';
import type { ViewMode } from './app-url-params';

/** Real-time cap on sim steps per frame; a slow frame drops sim time instead of spiralling. */
export const MAX_STEPS_PER_FRAME = 8;
/** Global rain of the free-play "Make it rain" toggle (units/s per cell): enough to pool in every hollow. */
export const FREE_PLAY_RAIN_RATE = 0.004;
/**
 * Lava rheology unless a level overrides it: runnier and slower to crust than the sim default, so brushed lava flows
 * and glows. Only these fields change per level; the sea level follows the render style (SandboxGpuScene.setStyle).
 */
export const SANDBOX_LAVA_FLOW: Readonly<Pick<LavaSimParams, 'damping' | 'coolingPerSec'>> = { damping: 0.975, coolingPerSec: 0.015 };
/** Molten lava this deep in a village's outer probe ring raises the "Lava close" warning. */
export const LAVA_NEAR_DEPTH = 0.05;

export interface SessionFrameOptions {
  /** Simulated seconds to advance (already scaled by any speed-up). */
  dtSim: number;
  maxSteps: number;
  view: ViewMode | null;
  camera: OrbitCamera | null;
  /** 2D only: map turned a quarter for portrait screens. */
  rotated?: boolean;
}
