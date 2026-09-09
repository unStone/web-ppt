import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    lib: { entry: { chart: 'src/chart/index.ts', 'chart-shared': 'src/chart-shared/index.ts' },
      fileName: (_format, name) => `${name}.js`, formats: ['es'] },
    rollupOptions: { external: ['@web-ppt/editor/chart', '@web-ppt/editor/chart-shared'] },
  },
});
