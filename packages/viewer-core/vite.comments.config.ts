import { defineConfig } from 'vite';

export default defineConfig({ build: {
  emptyOutDir: false, copyPublicDir: false,
  lib: { entry: 'src/comments.ts', fileName: 'comments', formats: ['es'] },
  rolldownOptions: { external: ['@web-ppt/core'] },
} });
