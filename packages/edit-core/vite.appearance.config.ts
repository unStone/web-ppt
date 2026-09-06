import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false, emptyOutDir: false,
    lib: { entry: 'src/appearance/index.ts', fileName: 'appearance', formats: ['es'] },
    rollupOptions: {
      external: ['@web-ppt/core', '@web-ppt/core/geometry', '@web-ppt/edit-core', 'fflate'],
    },
  },
});
