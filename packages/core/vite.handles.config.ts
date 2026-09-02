import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    lib: {
      entry: 'src/geometry/handles/index.ts', fileName: 'geometry-handles', formats: ['es'],
    },
  },
});
