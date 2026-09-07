import { defineConfig } from 'vite';
export default defineConfig({ build: { copyPublicDir: false, emptyOutDir: false,
  lib: { entry: 'src/ink/index.ts', fileName: 'ink', formats: ['es'] },
  rollupOptions: { external: ['@web-ppt/core/ink-edit', '@web-ppt/core', '@web-ppt/edit-core', '@web-ppt/edit-core/xml', '@web-ppt/edit-core/opc', '@web-ppt/edit-core/cfb', 'fflate'] },
} });
