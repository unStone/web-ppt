import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173 },
  build: {
    // public/ 里是测试用的 pptx 样本，只服务于 dev server，不该进发布产物
    copyPublicDir: false,
    lib: {
      // worker 单独出一个入口，调用方用 new Worker(new URL('.../worker.js', import.meta.url))
      entry: { core: 'src/index.ts', worker: 'src/worker.ts', geometry: 'src/pptx/geometry.ts' },
      name: 'WebPPT',
      formats: ['es'],
    },
  },
});
