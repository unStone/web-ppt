import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    lib: { entry: 'src/design/index.ts', fileName: 'design', formats: ['es'] },
    rollupOptions: { external: ['@web-ppt/core', '@web-ppt/edit-core', '@web-ppt/viewer-core'] },
  },
});
