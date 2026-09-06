import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false, emptyOutDir: false,
    lib: { entry: 'src/modern-charts.ts', fileName: 'modern-charts', formats: ['es'] },
    rollupOptions: { external: ['fflate', '@web-ppt/core', '@web-ppt/core/chart-ex'] },
  },
});
