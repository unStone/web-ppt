import { defineConfig } from 'vite';

export default defineConfig({ build: { copyPublicDir: false, emptyOutDir: false,
  lib: { entry: 'src/ink-edit.ts', fileName: 'ink-edit', formats: ['es'] },
} });
