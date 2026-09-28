// window.__livesand: readiness flag, fatal error text and a debug API used by e2e tests and curious users.

export interface LiveSandDebugApi {
  /** Current water depth per cell (row-major, north = row 0). */
  readWater(): Promise<Float32Array>;
  /** Copy of the CPU terrain heightmap. */
  getHeights(): Float32Array;
  /** Runs n live-like frames (held pointer input included) of dtSec each (default 1/60 s) with the rAF loop paused; draws only the last. */
  stepFrames(n: number, dtSec?: number): Promise<void>;
  /** JSON-friendly snapshot of mode, level, game phase, villages, tool and timing. */
  state(): Record<string, unknown>;
}

export interface LiveSandGlobal {
  ready: boolean;
  error?: string;
  debug: LiveSandDebugApi;
}

declare global {
  interface Window {
    __livesand?: LiveSandGlobal;
  }
}

function notReady(): never {
  throw new Error('LiveSand is not ready yet (wait for window.__livesand.ready)');
}

const PENDING_DEBUG: LiveSandDebugApi = {
  readWater: () => Promise.reject(new Error('LiveSand is not ready yet')),
  getHeights: notReady,
  stepFrames: () => Promise.reject(new Error('LiveSand is not ready yet')),
  state: () => ({ ready: false }),
};

/** Creates the global early so tests can poll it before the GPU is up. */
export function installLiveSandGlobal(): LiveSandGlobal {
  const global: LiveSandGlobal = { ready: false, debug: PENDING_DEBUG };
  window.__livesand = global;
  return global;
}

export function publishDebugApi(api: LiveSandDebugApi): void {
  const global = window.__livesand ?? installLiveSandGlobal();
  global.debug = api;
}

export function markLiveSandReady(): void {
  const global = window.__livesand ?? installLiveSandGlobal();
  if (!global.error) global.ready = true;
}

export function reportLiveSandError(message: string): void {
  const global = window.__livesand ?? installLiveSandGlobal();
  global.ready = false;
  global.error = message;
}
