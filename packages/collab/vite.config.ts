import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    lib: { entry: 'src/index.ts', fileName: 'collab', formats: ['es'] },
    rollupOptions: { external: ['@web-ppt/edit-core'] },
  },
});
