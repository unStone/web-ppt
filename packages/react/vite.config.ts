import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    lib: { entry: 'src/index.ts', fileName: 'react', formats: ['es'] },
    rollupOptions: { external: ['@web-ppt/editor', 'react', 'react/jsx-runtime'] },
  },
});
