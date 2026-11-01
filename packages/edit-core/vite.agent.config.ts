import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false, emptyOutDir: false,
    lib: { entry: 'src/agent/index.ts', fileName: 'agent', formats: ['es'] },
    rollupOptions: { external: ['@web-ppt/core', '@web-ppt/core/node', '@web-ppt/edit-core'] },
  },
});
