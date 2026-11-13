import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    lib: { entry: 'src/chart-authoring/index.ts', fileName: 'chart-authoring', formats: ['es'] },
    rolldownOptions: {
      external: [
        '@web-ppt/core',
        '@web-ppt/core/geometry',
        '@web-ppt/core/chart-edit',
        '@web-ppt/edit-core',
        '@web-ppt/edit-core/chart',
        '@web-ppt/edit-core/xml',
        'fflate',
      ],
    },
  },
});
