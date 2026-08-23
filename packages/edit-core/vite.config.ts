import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    lib: {
      entry: { 'edit-core': 'src/index.ts', xml: 'src/xml/index.ts', opc: 'src/opc/index.ts', save: 'src/save/index.ts' },
      fileName: (_format, entryName) => `${entryName}.js`,
      formats: ['es'],
    },
    rollupOptions: { external: ['@web-ppt/core', '@web-ppt/core/geometry', 'fflate'] },
  },
});
