import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
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
    {
      /**
       * 构建期闸门：HTML 里出现重复 id 直接失败。
       *
       * 这不是洁癖。`querySelector('#x')` 只返回第一个匹配，曾因此让 drawArch()
       * 把整个 <section id="arch"> 连同 <h2> 与三条说明一起 innerHTML 覆盖掉——
       * 静态 HTML 看着好好的，只有渲染后才暴露，人眼很难发现。
       */
      name: 'assert-unique-ids',
      buildStart() {
        const html = readFileSync('index.html', 'utf8');
        const seen = new Map<string, number>();
        for (const m of html.matchAll(/\bid="([^"]+)"/g)) {
          seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
        }
        const dup = [...seen].filter(([, n]) => n > 1).map(([id, n]) => `#${id}×${n}`);
        if (dup.length) this.error(`index.html 存在重复 id：${dup.join('、')}`);
      },
    },
  ],
});
