import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    lib: { entry: 'src/chart-edit.ts', fileName: 'chart-edit', formats: ['es'] },
  },
});
