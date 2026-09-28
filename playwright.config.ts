import { defineConfig, devices } from '@playwright/test';

// Distinct ports let parallel runs coexist; LIVESAND_E2E_GPU=1 uses the real GPU instead of SwiftShader.
const port = Number(process.env.E2E_PORT ?? 5199);
// ANGLE backend is required for WebGPU canvas presentation in headless Chromium (SwiftShader alone loses the device).
const webgpuArgs = ['--enable-unsafe-webgpu', '--enable-features=Vulkan'];
webgpuArgs.push(process.env.LIVESAND_E2E_GPU === '1' ? '--use-angle=vulkan' : '--use-angle=swiftshader');

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
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
