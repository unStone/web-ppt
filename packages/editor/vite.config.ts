import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    lib: { entry: 'src/index.ts', fileName: 'editor', formats: ['es'] },
    rollupOptions: { external: ['@web-ppt/core', '@web-ppt/edit-core', '@web-ppt/viewer-core'] },
  },
});
