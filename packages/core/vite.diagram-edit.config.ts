import { defineConfig } from 'vite';

export default defineConfig({ build: { copyPublicDir: false, emptyOutDir: false,
  lib: { entry: 'src/diagram-edit.ts', fileName: 'diagram-edit', formats: ['es'] },
} });
