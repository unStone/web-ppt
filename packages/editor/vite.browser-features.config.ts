import { defineConfig } from 'vite';

export default defineConfig({ build: {
  copyPublicDir: false, emptyOutDir: false,
  lib: { entry: { accessibility: 'src/canvas-accessibility.ts', 'edit-context': 'src/edit-context/index.ts' },
    formats: ['es'], fileName: (_format, name) => `${name}.js` },
  rollupOptions: { external: ['@web-ppt/core', '@web-ppt/edit-core'] },
} });
