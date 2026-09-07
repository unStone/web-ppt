import { defineConfig } from 'vite';
export default defineConfig({ build: { copyPublicDir: false, emptyOutDir: false,
  lib: { entry: 'src/three-d.ts', fileName: 'three-d', formats: ['es'] },
  rollupOptions: { external: ['@web-ppt/core'] },
} });
