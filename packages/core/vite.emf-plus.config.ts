import { defineConfig } from 'vite';
export default defineConfig({ build: { copyPublicDir: false, emptyOutDir: false,
  lib: { entry: 'src/emf-plus.ts', fileName: 'emf-plus', formats: ['es'] },
  rolldownOptions: { external: ['fflate', '@web-ppt/core'] },
} });
