import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    lib: { entry: {fonts:'src/index.ts',glyphs:'src/glyphs/index.ts','glyphs-harfbuzz':'src/glyphs/harfbuzz.ts',
      'glyphs-worker':'src/glyphs/worker.ts','glyphs-browser':'src/glyphs/browser.ts'}, fileName: (_,name) => `${name}.js`, formats: ['es'] },
    // 只用到 core 的类型，运行时不引入
    rollupOptions: { external: ['@web-ppt/core'] },
  },
});
