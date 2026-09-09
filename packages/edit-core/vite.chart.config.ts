import { defineConfig } from 'vite';
import { compactLibrary } from '../../tooling/lib/compact-library';

export default defineConfig({
  plugins: [compactLibrary()],
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    lib: { entry: { chart: 'src/chart/index.ts', 'chart-shared': 'src/chart-shared/index.ts' },
      fileName: (_format, name) => `${name}.js`, formats: ['es'] },
    rollupOptions: {
      external: [
        '@web-ppt/core', '@web-ppt/core/chart-edit', '@web-ppt/core/geometry',
        '@web-ppt/edit-core', '@web-ppt/edit-core/xml', '@web-ppt/edit-core/opc', 'fflate',
      ],
    },
  },
});
