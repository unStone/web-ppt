import { defineConfig } from 'vite';
export default defineConfig({ build: { copyPublicDir: false, emptyOutDir: false,
  lib: { entry: { lint: 'src/lint/index.ts', 'lint-sampler': 'src/lint/sampler.ts' }, fileName: (_format, name) => `${name}.js`, formats: ['es'] },
  rollupOptions: { external: ['@web-ppt/core', '@web-ppt/edit-core', '@web-ppt/edit-core/xml'] },
} });
