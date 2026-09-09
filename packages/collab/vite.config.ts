import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    lib: { entry: { collab: 'src/index.ts', migration: 'src/migration/index.ts' }, formats: ['es'] },
    rollupOptions: { external: ['@web-ppt/edit-core'] },
  },
});
