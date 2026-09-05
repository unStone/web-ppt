import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    lib: { entry: 'src/chart/index.ts', fileName: 'chart', formats: ['es'] },
    rollupOptions: {
      external: [
        '@web-ppt/core', '@web-ppt/core/chart-edit', '@web-ppt/core/geometry',
        '@web-ppt/edit-core', '@web-ppt/edit-core/xml', '@web-ppt/edit-core/opc', 'fflate',
      ],
    },
  },
});
