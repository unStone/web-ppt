import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    lib: { entry: 'src/resize/index.ts', fileName: 'resize', formats: ['es'] },
    rolldownOptions: { external: ['@web-ppt/core', '@web-ppt/core/geometry', '@web-ppt/edit-core', 'fflate'] },
  },
});
