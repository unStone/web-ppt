import { defineConfig } from 'vite';

export default defineConfig({ build: { copyPublicDir: false, emptyOutDir: false,
  lib: { entry: 'src/smartart/index.ts', fileName: 'smartart', formats: ['es'] },
  rollupOptions: { external: ['@web-ppt/core', '@web-ppt/core/diagram-edit', '@web-ppt/core/geometry',
    '@web-ppt/edit-core', '@web-ppt/edit-core/xml', '@web-ppt/edit-core/opc', 'fflate'] },
} });
