import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    lib: { entry: 'src/templates/index.ts', fileName: 'templates', formats: ['es'] },
    rollupOptions: { external: ['@web-ppt/editor/templates'] },
  },
});
