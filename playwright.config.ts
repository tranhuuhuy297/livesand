import { defineConfig, devices } from '@playwright/test';
import { scaled } from './tests/e2e/e2e-timing';

// Distinct ports let parallel runs coexist; LIVESAND_E2E_GPU=1 uses the real GPU instead of SwiftShader.
const port = Number(process.env.E2E_PORT ?? 5199);
// Enough for compute/offscreen specs; canvas-presenting app specs add SwiftShader Vulkan in their helper, which would slow screenshots here.
const webgpuArgs = ['--enable-unsafe-webgpu', '--enable-features=Vulkan'];
webgpuArgs.push(process.env.LIVESAND_E2E_GPU === '1' ? '--use-angle=vulkan' : '--use-angle=swiftshader');

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: scaled(60_000),
  expect: { timeout: scaled(5_000) },
  // One retry on CI absorbs rare CPU-starvation stalls of the software renderer; local runs never retry.
  retries: process.env.CI ? 1 : 0,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    ...devices['Desktop Chrome'],
    launchOptions: { args: webgpuArgs },
  },
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
