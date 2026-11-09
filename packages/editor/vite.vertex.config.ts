import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    lib: { entry: 'src/vertex/index.ts', fileName: 'vertex', formats: ['es'] },
    rolldownOptions: { external: ['@web-ppt/core', '@web-ppt/edit-core', '@web-ppt/viewer-core'] },
  },
});
