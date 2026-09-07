import { defineConfig } from 'vite';
export default defineConfig({ build: { copyPublicDir: false, emptyOutDir: false,
  lib: { entry: 'src/ppt/index.ts', fileName: 'ppt', formats: ['es'] },
  rollupOptions: { external: ['@web-ppt/core', '@web-ppt/edit-core', '@web-ppt/edit-core/cfb'] },
} });
