import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: { external: ['@web-ppt/core'] },
    copyPublicDir: false,
    emptyOutDir: false,
    lib: {
      // 批量 ZIP 只在显式导入子路径时进入应用，默认 core 入口不承担打包器成本。
      entry: { 'image-zip': 'src/image-zip.ts' },
      name: 'WebPPTImageZip',
      formats: ['es'],
    },
  },
});
