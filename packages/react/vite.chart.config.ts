import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    lib: { entry: 'src/chart/index.ts', fileName: 'chart', formats: ['es'] },
    rollupOptions: { external: ['@web-ppt/editor/chart'] },
  },
});
