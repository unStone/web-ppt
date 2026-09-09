import { defineConfig } from 'vite';
import { compactLibrary } from '../../tooling/lib/compact-library';

export default defineConfig({
  plugins: [compactLibrary()],
  build: {
    copyPublicDir: false,
    lib: { entry: 'src/index.ts', fileName: 'editor', formats: ['es'] },
    rollupOptions: { external: ['@web-ppt/edit-core/generate', '@web-ppt/core', '@web-ppt/edit-core', '@web-ppt/viewer-core'] },
  },
});
