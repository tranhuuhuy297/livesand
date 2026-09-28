// Software-rendered WebGPU on small CI runners is several times slower than a desktop GPU, so e2e waits scale up there.
export const E2E_SLOWDOWN = Number(process.env.E2E_SLOWDOWN ?? (process.env.CI ? 4 : 1));

/** Scales a timeout (ms) by the environment's slowdown factor. */
export const scaled = (ms: number): number => Math.round(ms * E2E_SLOWDOWN);
