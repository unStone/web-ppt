import { copyFileSync, mkdirSync } from 'node:fs';
import { defineConfig } from 'vite';

// GitHub Pages 部署在 /web-ppt/ 子路径下；本地 dev 用根路径
const base = process.env.SITE_BASE ?? '/';

export default defineConfig({
  base,
  server: { port: 5174 },
  build: { outDir: 'dist', emptyOutDir: true },
  plugins: [
    {
      // Demo 用的样本文件放在仓库根的 fixtures/，构建时挑几个带进产物
      name: 'copy-demo-fixtures',
      buildStart() {
        mkdirSync('public/demo', { recursive: true });
        for (const f of ['showcase.pptx', 'showcase.ppt', 'sample-chart.pptx', 'hardcases.pptx']) {
          copyFileSync(`../../fixtures/${f}`, `public/demo/${f}`);
        }
      },
    },
  ],
});
