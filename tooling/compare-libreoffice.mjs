/**
 * 用 LibreOffice 渲染参考图，与本引擎输出做量化对照。
 *
 *   npm run compare fixtures/showcase.pptx
 *
 * 产出 out/compare/<name>/compare.html —— 单文件、自包含（引擎、样本、参考图全部内联），
 * 直接 open 即可，不需要 dev server。
 *
 * 为什么要量化：快照只能发现「和上次不一样」，发现不了「一开始就画错」。
 * 历史教训是 shade/tint 在 sRGB 里直乘，最大偏差 Δ69，快照一路绿着。
 * 所以这里给出 MAE / Δmax / 差异像素占比 / SSIM 四个数，外加差异热力图。
 *
 * 注意：LibreOffice 自己也只是另一种近似实现（字体、抗锯齿、图表画法都不同），
 * SSIM 不会到 1。它的用途是横向比较改动前后、以及定位整片偏色的区域，不是及格线。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
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
  console.error('用法: npm run compare <文件.pptx|文件.ppt>');
  process.exit(1);
}

const soffice = findSoffice();
if (!soffice) {
  console.error('未找到 LibreOffice。macOS: brew install --cask libreoffice');
  process.exit(1);
}

const src = resolve(root, input);
if (!existsSync(src)) {
  console.error(`找不到文件: ${src}`);
  process.exit(1);
}
const name = basename(src).replace(/\.[^.]+$/, '');
const outDir = join(root, 'out/compare', name);
mkdirSync(outDir, { recursive: true });

const REF_W = 1280;
const REF_H = 720;
const filter = `png:impress_png_Export:{"PixelWidth":{"type":"long","value":${REF_W}},"PixelHeight":{"type":"long","value":${REF_H}}}`;
console.log('LibreOffice 渲染中…（仅导出第一页）');
execFileSync(soffice, ['--headless', '--norestore', '--convert-to', filter, '--outdir', outDir, src], {
  stdio: 'inherit',
  timeout: 300_000,
});

const refPath = join(outDir, 'reference.png');
for (const f of readdirSync(outDir)) {
  if (f.endsWith('.png') && f !== 'reference.png') renameSync(join(outDir, f), refPath);
}
if (!existsSync(refPath)) {
  console.error('LibreOffice 未产出参考图');
  process.exit(1);
}

// 打成 iife：产物要能在 file:// 下用普通 <script> 跑，ES module 在 file:// 会被 CORS 拦掉
console.log('打包引擎…');
const bundlePath = join(outDir, 'core.iife.js');
execFileSync('npx', [
  'esbuild', join(root, 'packages/core/src/index.ts'),
  '--bundle', '--format=iife', '--global-name=WebPPT', '--platform=browser',
  `--outfile=${bundlePath}`,
], { stdio: 'inherit', cwd: root });

const engine = readFileSync(bundlePath, 'utf8');
unlinkSync(bundlePath);
const refB64 = readFileSync(refPath).toString('base64');
const srcB64 = readFileSync(src).toString('base64');

writeFileSync(join(outDir, 'compare.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>对比 · ${name}</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;background:#16181d;color:#d7dbe2;font-family:-apple-system,'PingFang SC',sans-serif}
  header{padding:10px 16px;border-bottom:1px solid #2c313b;display:flex;gap:18px;align-items:center;flex-wrap:wrap}
  h1{font-size:14px;margin:0;font-weight:600}
  label{font-size:12px;color:#8a919e;display:flex;gap:6px;align-items:center}
  .metrics{display:flex;gap:0;border-bottom:1px solid #2c313b;font-size:12px}
  .metrics div{padding:8px 16px;border-right:1px solid #2c313b}
  .metrics b{display:block;font-size:17px;color:#e8ecf3;font-weight:600;margin-top:2px}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px}
  .cell{background:#fff;border-radius:4px;overflow:hidden;position:relative}
  .cap{font-size:12px;color:#8a919e;padding:0 0 6px}
  canvas{width:100%;display:block}
  #mineC{position:absolute;inset:0;width:100%;height:100%}
  .hide{display:none}
  #err{padding:16px;color:#ff8a80;white-space:pre-wrap;font:12px ui-monospace,monospace}
</style></head>
<body>
<header>
  <h1>渲染对比 · ${name}</h1>
  <label><input type="checkbox" id="overlay"> 叠加</label>
  <label>不透明度 <input type="range" id="op" min="0" max="100" value="50"></label>
  <label><input type="checkbox" id="heat"> 差异热力图</label>
</header>
<div class="metrics" id="metrics"><div>计算中…</div></div>
<div class="row" id="row">
  <div><div class="cap">LibreOffice 参考（第 1 页）</div><div class="cell"><canvas id="refC"></canvas><canvas id="mineC" class="hide"></canvas></div></div>
  <div><div class="cap">Web-PPT 渲染</div><div class="cell"><canvas id="myC"></canvas></div></div>
</div>
<pre id="err"></pre>
<script>${engine}</script>
<script>
const b64 = (s) => { const raw = atob(s); const u = new Uint8Array(raw.length); for (let i=0;i<raw.length;i++) u[i]=raw.charCodeAt(i); return u; };
const REF = b64(${JSON.stringify(refB64)});
const SRC = b64(${JSON.stringify(srcB64)});

function gray(d, i) { return 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]; }

/** 灰度 SSIM，8×8 非重叠窗口 */
function ssim(a, b, w, h) {
  const C1 = (0.01*255)**2, C2 = (0.03*255)**2, B = 8;
  let sum = 0, n = 0;
  for (let by = 0; by + B <= h; by += B) {
    for (let bx = 0; bx + B <= w; bx += B) {
      let ma=0, mb=0;
      for (let y=0;y<B;y++) for (let x=0;x<B;x++) { const i=((by+y)*w+bx+x)*4; ma+=gray(a,i); mb+=gray(b,i); }
      const N = B*B; ma/=N; mb/=N;
      let va=0, vb=0, cov=0;
      for (let y=0;y<B;y++) for (let x=0;x<B;x++) {
        const i=((by+y)*w+bx+x)*4; const da=gray(a,i)-ma, db=gray(b,i)-mb;
        va+=da*da; vb+=db*db; cov+=da*db;
      }
      va/=N-1; vb/=N-1; cov/=N-1;
      sum += ((2*ma*mb+C1)*(2*cov+C2))/((ma*ma+mb*mb+C1)*(va+vb+C2));
      n++;
    }
  }
  return n ? sum/n : 1;
}

(async () => {
  try {
    const pres = await WebPPT.parse(SRC.buffer.slice(SRC.byteOffset, SRC.byteOffset + SRC.byteLength));
    const W = ${REF_W}, H = ${REF_H};
    const scale = W / pres.width;

    const refBmp = await createImageBitmap(new Blob([REF], { type: 'image/png' }));
    const myBlob = await WebPPT.slideToPng(pres, pres.slides[0], scale);
    const myBmp = await createImageBitmap(myBlob);

    const draw = (id, bmp) => {
      const c = document.getElementById(id);
      c.width = W; c.height = H;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#fff'; g.fillRect(0,0,W,H);
      g.drawImage(bmp, 0, 0, W, H);
      return g.getImageData(0,0,W,H).data;
    };
    const A = draw('refC', refBmp);
    const B = draw('myC', myBmp);
    draw('mineC', myBmp);

    let sum = 0, max = 0, diffPx = 0;
    const N = W*H;
    for (let i=0;i<A.length;i+=4) {
      const d0=Math.abs(A[i]-B[i]), d1=Math.abs(A[i+1]-B[i+1]), d2=Math.abs(A[i+2]-B[i+2]);
      sum += d0+d1+d2;
      const m = Math.max(d0,d1,d2);
      if (m > max) max = m;
      if (m > 8) diffPx++;
    }
    const mae = sum/(N*3);
    const s = ssim(A, B, W, H);
    document.getElementById('metrics').innerHTML =
      '<div>SSIM<b>' + s.toFixed(4) + '</b></div>' +
      '<div>平均绝对误差<b>' + mae.toFixed(2) + '</b></div>' +
      '<div>最大通道偏差<b>Δ' + max + '</b></div>' +
      '<div>差异像素（Δ&gt;8）<b>' + (100*diffPx/N).toFixed(2) + '%</b></div>';

    // 差异热力图：偏差越大越红
    const heatData = new ImageData(W, H);
    for (let i=0;i<A.length;i+=4) {
      const m = Math.max(Math.abs(A[i]-B[i]), Math.abs(A[i+1]-B[i+1]), Math.abs(A[i+2]-B[i+2]));
      const t = Math.min(1, m/64);
      heatData.data[i]   = 255*t;
      heatData.data[i+1] = 255*(1-t)*0.35;
      heatData.data[i+2] = 255*(1-t)*0.6;
      heatData.data[i+3] = m > 4 ? 255 : 24;
    }

    const myC = document.getElementById('myC');
    const mineC = document.getElementById('mineC');
    const row = document.getElementById('row');
    const op = document.getElementById('op');
    const heat = document.getElementById('heat');
    const overlay = document.getElementById('overlay');

    const repaint = () => {
      const g = myC.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0,0,W,H);
      if (heat.checked) g.putImageData(heatData, 0, 0);
      else g.drawImage(myBmp, 0, 0, W, H);
    };
    overlay.addEventListener('change', () => {
      mineC.classList.toggle('hide', !overlay.checked);
      row.style.gridTemplateColumns = overlay.checked ? '1fr' : '1fr 1fr';
      row.children[1].classList.toggle('hide', overlay.checked);
      mineC.style.opacity = op.value/100;
    });
    op.addEventListener('input', () => { mineC.style.opacity = op.value/100; });
    heat.addEventListener('change', repaint);
  } catch (e) {
    document.getElementById('err').textContent = '出错：' + (e && e.stack || e);
    document.getElementById('metrics').innerHTML = '<div>失败</div>';
  }
})();
</script>
</body></html>`);

console.log(`完成：${join(outDir, 'compare.html')}`);
console.log(`直接打开即可（无需 dev server）：open ${join(outDir, 'compare.html')}`);
