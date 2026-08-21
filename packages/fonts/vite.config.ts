import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    lib: { entry: 'src/index.ts', fileName: 'fonts', formats: ['es'] },
    // 只用到 core 的类型，运行时不引入
    rollupOptions: { external: ['@web-ppt/core'] },
  },
});
