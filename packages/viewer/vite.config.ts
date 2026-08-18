import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173 },
  // 测试用的 pptx 样本放在仓库根的 fixtures/，dev server 直接当静态资源服务
  publicDir: '../../fixtures',
});
