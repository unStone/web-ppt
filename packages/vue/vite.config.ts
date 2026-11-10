import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    lib: { entry: 'src/index.ts', fileName: 'vue', formats: ['es'] },
    rolldownOptions: { external: ['@web-ppt/editor', 'vue'] },
  },
});
