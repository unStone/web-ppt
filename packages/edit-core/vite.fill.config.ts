import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    lib: { entry: 'src/fill/index.ts', fileName: 'fill', formats: ['es'] },
    rolldownOptions: {
      external: [/^@web-ppt\/(?:core|edit-core)(?:\/|$)/, 'fflate'],
    },
  },
});
