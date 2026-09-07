import { defineConfig } from 'vite';
export default defineConfig({ build: { copyPublicDir: false, emptyOutDir: false,
  lib: { entry: 'src/advanced-rendering.ts', fileName: 'advanced-rendering', formats: ['es'] },
  rollupOptions: { external: ['fflate', '@web-ppt/core/emf-plus', '@web-ppt/core/three-d'] },
} });
