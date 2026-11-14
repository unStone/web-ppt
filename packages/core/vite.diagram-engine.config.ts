import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    lib: { entry: 'src/diagram-engine.ts', fileName: 'diagram-engine', formats: ['es'] },
    rolldownOptions: {
      external: ['@web-ppt/core/geometry', 'fflate'],
    },
  },
});
