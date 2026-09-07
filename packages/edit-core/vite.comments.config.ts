import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false, emptyOutDir: false,
    lib: { entry: 'src/comments/index.ts', fileName: 'comments', formats: ['es'] },
    rollupOptions: { external: ['@web-ppt/core', '@web-ppt/core/geometry', '@web-ppt/edit-core', 'fflate'] },
  },
});
