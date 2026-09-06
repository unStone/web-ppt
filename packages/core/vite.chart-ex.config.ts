import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    lib: { entry: 'src/chart-ex.ts', fileName: 'chart-ex', formats: ['es'] },
  },
});
