import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    lib: { entry: 'src/adjustments/index.ts', fileName: 'adjustments', formats: ['es'] },
    rollupOptions: {
      external: [
        '@web-ppt/core', '@web-ppt/core/geometry/handles',
        '@web-ppt/edit-core', '@web-ppt/viewer-core',
      ],
    },
  },
});
