import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { defineConfig } from 'vite';
import { fetchSamples, type Sample } from './src/samples-index';

/** 多页站点：每加一个页面就在这儿登记，构建入口和 id 校验都从这里取 */
const PAGES = ['index.html', 'samples.html', 'editor.html'];

// GitHub Pages 部署在 /web-ppt/ 子路径下；本地 dev 用根路径
const base = process.env.SITE_BASE ?? '/';

/** 构建期从样本库拉到的清单，供 samples.html 预渲染 */
let prerendered: Sample[] = [];
/** 已内联进 HTML、可以从产物里删掉的样式表 */
const inlined = new Set<string>();

/** 外部数据一律转义后才拼进 HTML */
const esc = (v: string): string =>
  v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * 一张样本卡的静态形态，与 src/samples.ts 里 card() 生成的 DOM 保持一致。
 *
 * `data-file` / `data-url` 是给运行时认领用的：预览要的三样（file / url / title）
 * 两个在属性里，标题直接读 h3，不必为了接事件再拉一次清单。
 *
 * 出处链接指向不受控的第三方，加 nofollow——收录样本不等于给对方背书。
 */
function cardHtml(s: Sample): string {
  const bits = [s.author, s.license].filter(Boolean).map(esc);
  let credit = bits.join(' · ');
  if (s.source) {
    credit += `${credit ? ' · ' : ''}<a href="${esc(s.source)}" target="_blank" rel="noopener noreferrer nofollow">出处</a>`;
  }
  return (
    `<article class="sample-card" data-file="${esc(s.file)}" data-url="${esc(s.url)}">` +
    `<h3>${esc(s.title)}</h3>` +
    (s.highlight ? `<p class="sample-highlight">${esc(s.highlight)}</p>` : '') +
    '<div class="sample-foot">' +
    '<button class="chip act" data-preview>预览</button>' +
    `<a class="chip" href="./?sample=${encodeURIComponent(s.file)}" title="带缩略图栏与全屏演示的完整查看器">在首页打开</a>` +
    '</div>' +
    (credit ? `<p class="sample-credit">${credit}</p>` : '') +
    '</article>'
  );
}

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
         * 共享 chunk 与样式表显式命名。
         *
         * 默认名取自 rollup 随手挑中的某个内部模块——整个引擎所在的 chunk 一会儿
         * 叫 `fetch-bytes-*.js`、一会儿叫 `samples-index-*.js`，连 vite 的 preload
         * 垫片都能叫成 `style-*.js`。名字与内容毫无关系，换个 import 顺序就会变，
         * 排查线上问题时纯属干扰。
         *
         * 所以按**内容**认，不按 rollup 给的名字认：认得出来的叫真名，认不出来的
         * 老实叫 chunk，别硬安一个听着像那么回事的名字。
         */
        chunkFileNames: (info) => {
          const has = (frag: string): boolean => info.moduleIds.some((m) => m.includes(frag));
          if (info.facadeModuleId?.endsWith('/src/main.ts')) return 'assets/demo-[hash].js';
          if (has(`${sep}packages${sep}core${sep}`)) return 'assets/engine-[hash].js';
          if (has('vite/modulepreload-polyfill')) return 'assets/preload-[hash].js';
          return 'assets/chunk-[hash].js';
        },
        assetFileNames: (info) =>
          info.name?.endsWith('.css') ? 'assets/style-[hash][extname]' : 'assets/[name]-[hash][extname]',
      },
    },
  },
  plugins: [
    {
      /**
       * 样本卡构建时预渲染进 samples.html。
       *
       * 这页原本整个卡片区都是 JS 从远程清单拉下来再建 DOM 的，爬虫（首轮不执行
       * JS）看到的正文只有 30 词——十几份样本的标题、看点、授权，搜索引擎一个字
       * 都读不到，而这恰恰是最容易被搜到的长尾。
       *
       * 预渲染只改「谁来生成第一份 DOM」，运行时行为不变：点了才下载、才渲染。
       * 清单拉不到就什么也不做，留着原来的占位符走 JS 那条路——官网构建不该
       * 因为另一个仓库不可达而失败。
       */
      name: 'prerender-samples',
      apply: 'build',
      async buildStart() {
        prerendered = await fetchSamples();
        if (!prerendered.length) this.warn('样本清单取不到，samples.html 退回运行时渲染');
      },
      transformIndexHtml: {
        order: 'pre',
        handler(html, ctx) {
          if (!ctx.path.endsWith('samples.html') || !prerendered.length) return html;
          return html.replace(
            /(<div class="sample-grid" id="sampleGrid">)[\s\S]*?(<\/div>)/,
            (_m, open: string, close: string) => open + prerendered.map(cardHtml).join('') + close,
          );
        },
      },
    },
    {
      /**
       * 把样式表内联进 HTML。
       *
       * 4KB 的样式表换一整个往返：HTML 到齐了浏览器才知道要它，拿到它才敢画第一帧。
       * 实测这一下让 LCP 多等 1.1s——首屏能不能画，卡在一个比图标还小的文件上。
       *
       * 内联之后产物里那份 .css 就没人引了，顺手从 bundle 里删掉，免得留个
       * 谁也不会去下载的孤儿文件。
       */
      name: 'inline-css',
      apply: 'build',
      enforce: 'post',
      transformIndexHtml: {
        order: 'post',
        handler(html, ctx) {
          if (!ctx.bundle) return html;
          return html.replace(/<link[^>]+rel="stylesheet"[^>]*>/g, (tag) => {
            const href = /href="([^"]+)"/.exec(tag)?.[1];
            if (!href) return tag;
            const name = href.slice(base.length).replace(/^\//, '');
            const asset = ctx.bundle![name];
            if (!asset || asset.type !== 'asset') return tag;
            inlined.add(name);
            return `<style>${String(asset.source)}</style>`;
          });
        },
      },
      generateBundle(_options, bundle) {
        for (const name of inlined) delete bundle[name];
      },
    },
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
