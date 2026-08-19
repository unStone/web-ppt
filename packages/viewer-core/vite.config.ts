import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    lib: { entry: 'src/index.ts', fileName: 'viewer-core', formats: ['es'] },
    // core 由使用方提供，不打进产物
    rollupOptions: { external: ['@web-ppt/core'] },
  },
});
