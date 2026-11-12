import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    lib: { entry: 'src/templates/index.ts', fileName: 'templates', formats: ['es'] },
    rolldownOptions: { external: ['@web-ppt/core', 'fflate'] },
  },
});
