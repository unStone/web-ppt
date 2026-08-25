import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    lib: { entry: 'src/index.ts', fileName: 'vue', formats: ['es'] },
    rollupOptions: { external: ['@web-ppt/editor', 'vue'] },
  },
});
