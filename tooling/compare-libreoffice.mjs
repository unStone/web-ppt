/**
 * 用 LibreOffice 渲染参考图，与本引擎输出并排对比。
 *
 *   node scripts/compare-libreoffice.mjs fixtures/showcase.pptx
 *
 * 产出 out/compare/<name>/reference.png（LibreOffice）以及一个 compare.html，
 * 在浏览器打开即可左右对照本引擎的实时渲染结果。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const SOFFICE_CANDIDATES = [
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/bin/soffice',
  '/usr/local/bin/soffice',
  'soffice',
];

function findSoffice() {
  for (const p of SOFFICE_CANDIDATES) {
    if (p === 'soffice' || existsSync(p)) return p;
  }
  return null;
}

const input = process.argv[2];
if (!input) {
  console.error('用法: node scripts/compare-libreoffice.mjs <文件.pptx|文件.ppt>');
  process.exit(1);
}

const soffice = findSoffice();
if (!soffice) {
  console.error('未找到 LibreOffice。macOS: brew install --cask libreoffice');
  process.exit(1);
}

const src = resolve(root, input);
const name = basename(src).replace(/\.[^.]+$/, '');
const outDir = join(root, 'out/compare', name);
mkdirSync(outDir, { recursive: true });

const filter = 'png:impress_png_Export:{"PixelWidth":{"type":"long","value":1280},"PixelHeight":{"type":"long","value":720}}';
console.log('LibreOffice 渲染中…（仅导出第一页）');
execFileSync(soffice, ['--headless', '--norestore', '--convert-to', filter, '--outdir', outDir, src], {
  stdio: 'inherit',
  timeout: 300_000,
});

for (const f of readdirSync(outDir)) {
  if (f.endsWith('.png') && f !== 'reference.png') renameSync(join(outDir, f), join(outDir, 'reference.png'));
}

// 相对 dev server 根目录的路径，供 compare.html 里 fetch
const publicPath = src.startsWith(join(root, 'fixtures'))
  ? src.slice(join(root, 'fixtures').length)
  : `/${basename(src)}`;

writeFileSync(join(outDir, 'compare.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>对比 · ${name}</title>
<style>
  body{margin:0;background:#16181d;color:#d7dbe2;font-family:-apple-system,'PingFang SC',sans-serif}
  header{padding:10px 16px;border-bottom:1px solid #2c313b;display:flex;gap:16px;align-items:center}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px}
  .cell{background:#fff;border-radius:4px;overflow:hidden}
  .cap{font-size:12px;color:#8a919e;padding:6px 12px 0}
  img,svg{width:100%;display:block}
  label{font-size:12px;color:#8a919e}
</style></head>
<body>
<header><strong>渲染对比 · ${name}</strong>
<label>叠加模式 <input type="checkbox" id="overlay"></label>
<label>不透明度 <input type="range" id="op" min="0" max="100" value="50"></label></header>
<div class="row">
  <div><div class="cap">LibreOffice 参考（第 1 页）</div><div class="cell"><img id="ref" src="reference.png"></div></div>
  <div><div class="cap">Web-PPT 渲染</div><div class="cell" id="mine"></div></div>
</div>
<script type="module">
  import { parse, renderSlideToSvg } from '/src/index.ts';
  const res = await fetch('${publicPath}');
  const pres = await parse(await res.arrayBuffer());
  document.getElementById('mine').innerHTML = renderSlideToSvg(pres, pres.slides[0]);
  const overlay = document.getElementById('overlay');
  const op = document.getElementById('op');
  const apply = () => {
    const mine = document.getElementById('mine');
    if (overlay.checked) {
      mine.style.position = 'absolute';
      mine.style.inset = '0';
      mine.style.opacity = op.value / 100;
      document.querySelector('.row').style.gridTemplateColumns = '1fr';
      document.getElementById('ref').parentElement.style.position = 'relative';
      document.getElementById('ref').parentElement.appendChild(mine);
    } else {
      location.reload();
    }
  };
  overlay.addEventListener('change', apply);
  op.addEventListener('input', () => { if (overlay.checked) document.getElementById('mine').style.opacity = op.value/100; });
</script>
</body></html>`);

console.log(`完成：${join(outDir, 'reference.png')}`);
console.log(`启动 npm run dev 后打开 http://localhost:5173/out/compare/${name}/compare.html 查看对比`);
