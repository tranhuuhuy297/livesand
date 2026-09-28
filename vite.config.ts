import { defineConfig } from 'vite';

// Relative base so the same build works on GitHub Pages and behind the local relay server.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', target: 'es2022', sourcemap: true },
  server: { port: 5173 },
  // Pre-bundle so late dependency discovery never reloads pages mid-test.
  optimizeDeps: { include: ['qrcode', 'wgpu-matrix'] },
});
