import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false, emptyOutDir: false,
    lib: { entry: 'src/media/index.ts', fileName: 'media', formats: ['es'] },
    rollupOptions: { external: ['@web-ppt/editor/media'] },
  },
});
