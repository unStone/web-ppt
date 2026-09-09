import { defineConfig } from 'vite';
export default defineConfig({ build: { copyPublicDir: false, emptyOutDir: false,
  lib: { entry: {pdf:'src/pdf.ts','pdf-vector':'src/pdf/vector.ts','pdf-vector-browser':'src/pdf/vector-browser.ts'}, fileName: (_format,name) => `${name}.js`, formats: ['es'] },
  rollupOptions: { external: ['fflate', '@web-ppt/core'] },
} });
