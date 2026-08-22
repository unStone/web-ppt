import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/** 多页站点：每加一个页面就在这儿登记，构建入口和 id 校验都从这里取 */
const PAGES = ['index.html', 'samples.html'];

// GitHub Pages 部署在 /web-ppt/ 子路径下；本地 dev 用根路径
const base = process.env.SITE_BASE ?? '/';

export default defineConfig({
  base,
  server: { port: 5174 },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(PAGES.map((f) => [f.replace('.html', ''), resolve(__dirname, f)])),
      output: {
        /**
         * 共享 chunk 显式命名。
         *
         * 默认名取自 rollup 随手挑的某个内部模块，上一版叫 `fetch-bytes-*.js` ——
         * 整个引擎都在这个 chunk 里，名字却像个埋点脚本，实测被浏览器拦截器
         * 判成 ERR_BLOCKED_BY_CLIENT，一挡就是整站白屏。名字本来就没有含义，
         * 不如钉一个中性的。
         */
        chunkFileNames: 'assets/engine-[hash].js',
        // 样式表同理：它的默认名也来自那个随机挑中的模块
        assetFileNames: (info) =>
          info.name?.endsWith('.css') ? 'assets/style-[hash][extname]' : 'assets/[name]-[hash][extname]',
      },
    },
  },
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
        for (const page of PAGES) {
          const html = readFileSync(page, 'utf8');
          const seen = new Map<string, number>();
          for (const m of html.matchAll(/\bid="([^"]+)"/g)) {
            seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
          }
          const dup = [...seen].filter(([, n]) => n > 1).map(([id, n]) => `#${id}×${n}`);
          if (dup.length) this.error(`${page} 存在重复 id：${dup.join('、')}`);
        }
      },
    },
  ],
});
