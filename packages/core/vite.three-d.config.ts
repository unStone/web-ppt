import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    lib: { entry: 'src/three-d.ts', fileName: 'three-d', formats: ['es'] },
    rolldownOptions: { external: ['@web-ppt/core'] },
  },
});
