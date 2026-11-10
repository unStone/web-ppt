import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    lib: { entry: 'src/describe/index.ts', fileName: 'describe', formats: ['es'] },
    rolldownOptions: { external: ['@web-ppt/core', '@web-ppt/edit-core'] },
  },
});
