import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: { external: ['@web-ppt/core'] },
    copyPublicDir: false,
    emptyOutDir: false,
    lib: {
      // Node 无 Office 渲染只在显式导入子路径时进入应用；宿主注入测字与光栅化，
      // core 自身不携带任何 Node 专属依赖。
      entry: { node: 'src/node-export.ts' },
      name: 'WebPPTNode',
      formats: ['es'],
    },
  },
});
