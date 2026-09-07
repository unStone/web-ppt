import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false, emptyOutDir: false,
    lib: { entry: 'src/chart-design/index.ts', fileName: 'chart-design', formats: ['es'] },
    rollupOptions: { external: ['@web-ppt/core', '@web-ppt/core/geometry', '@web-ppt/edit-core', '@web-ppt/edit-core/chart', '@web-ppt/core/chart-edit', '@web-ppt/edit-core/xml', 'fflate'] },
  },
});
