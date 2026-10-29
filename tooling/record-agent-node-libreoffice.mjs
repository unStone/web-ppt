/**
 * Agent 003：Node 注入路径与 LibreOffice 的像素对照记录（说明性，非门禁）。
 *
 *   node tooling/record-agent-node-libreoffice.mjs [固件名 ...]
 *
 * Node 渲染（注入 HarfBuzz 测量 + resvg 光栅化，即 Agent 的真实使用形态）与
 * LibreOffice 导出 PNG 做像素对比，每固件对照第一页（与 compare-libreoffice 同
 * 口径——soffice 直接转 PNG 只导出首页），产出 MAE / Δmax / 差异像素占比 /
 * SSIM（8×8 非重叠窗口）。LibreOffice 自身是另一种近似（字体、抗锯齿、画法都
 * 不同），数值用于横向比较与定位整片差异，不是及格线——票据 003 的验收要求。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { PNG } from 'pngjs';
import * as hb from 'harfbuzzjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'out/agent-node-render/libreoffice');
mkdirSync(out, { recursive: true });

const SOFFICE_CANDIDATES = [
  '/Applications/LibreOffice.app/Contents/MacOS/soffice', '/usr/bin/soffice', '/usr/local/bin/soffice', 'soffice',
];
const soffice = SOFFICE_CANDIDATES.find((p) => p === 'soffice' || existsSync(p));
if (!soffice) throw new Error('未找到 LibreOffice；macOS: brew install --cask libreoffice');

const REF_W = 1280, REF_H = 720;
const filter = `png:impress_png_Export:{"PixelWidth":{"type":"long","value":${REF_W}},"PixelHeight":{"type":"long","value":${REF_H}}}`;

const requested = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const FIXTURES = (requested.length ? requested : ['sample.pptx', 'showcase.pptx', 'sample-cjk-squeeze.pptx'])
  .map((name) => join(root, 'fixtures', name));

// Node 渲染入口：与 parity 测试同构（字体 Provider + HarfBuzz 注入）
const outApi = resolve(root, 'out/agent-node-render');
const entry = join(outApi, 'libreoffice-entry.ts');
writeFileSync(entry,
  `export * from '${join(root, 'packages/core/src/node-export.ts')}';\n`
  + `export * from '${join(root, 'packages/core/src/index.ts')}';\n`
  + `export * from '${join(root, 'packages/fonts/src/glyphs/index.ts')}';\n`
  + `export * from '${join(root, 'packages/fonts/src/glyphs/harfbuzz.ts')}';\n`);
const bundle = join(outApi, 'libreoffice-bundle.mjs');
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', '--platform=node', '--log-level=warning', `--outfile=${bundle}`], { cwd: root, stdio: 'inherit' });
const lib = await import(pathToFileURL(bundle).href);
const { createFontProvider, withFontMeasurement } = lib;
const { fontSample } = await import('./lib/font-glyph-samples.mjs');
const provider = createFontProvider({ loadShaper: async () => lib.createHarfBuzzShaper(hb) });
await provider.register({ id: 'latin', origin: 'explicit', bytes: fontSample('latin.ttf') }, { purpose: 'edit' });
await provider.register({ id: 'bold', origin: 'explicit', bytes: fontSample('latin-bold.ttf') }, { purpose: 'edit' });
await provider.register({ id: 'chinese', origin: 'explicit', bytes: fontSample('chinese.ttf') }, { purpose: 'edit' });
const faceForRun = (style, script) => (script === 'cjk' || script === 'hani' ? 'chinese' : style.b ? 'bold' : 'latin');

/** SSIM：8×8 非重叠窗口，与 compare-libreoffice 的口径一致。 */
function ssim(a, b, w, h) {
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2, B = 8;
  let sum = 0, n = 0;
  for (let by = 0; by + B <= h; by += B) for (let bx = 0; bx + B <= w; bx += B) {
    let ma = 0, mb = 0;
    for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) {
      ma += a[(by + y) * w + bx + x]; mb += b[(by + y) * w + bx + x];
    }
    ma /= B * B; mb /= B * B;
    let va = 0, vb = 0, cov = 0;
    for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) {
      const da = a[(by + y) * w + bx + x] - ma, db = b[(by + y) * w + bx + x] - mb;
      va += da * da; vb += db * db; cov += da * db;
    }
    va /= B * B - 1; vb /= B * B - 1; cov /= B * B - 1;
    sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++;
  }
  return n ? sum / n : 1;
}

function grayOf(data, w, h) {
  const g = new Float64Array(w * h);
  for (let i = 0; i < g.length; i++) {
    const o = i * 4;
    const alpha = data[o + 3] / 255;
    g[i] = (data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114) * alpha + 255 * (1 - alpha);
  }
  return g;
}

function metrics(nodePng, officePng) {
  const w = Math.min(nodePng.width, officePng.width), h = Math.min(nodePng.height, officePng.height);
  const a = grayOf(nodePng.data, w, h), b = grayOf(officePng.data, w, h);
  let sum = 0, max = 0, diff = 0;
  for (let i = 0; i < w * h; i++) {
    const d = Math.abs(a[i] - b[i]);
    sum += d; if (d > max) max = d; if (d > 8) diff++;
  }
  return { mae: +(sum / (w * h)).toFixed(2), deltaMax: Math.round(max), diffRatioPct: +(diff / (w * h) * 100).toFixed(2), ssim: +ssim(a, b, w, h).toFixed(4) };
}

const report = [];
for (const fixture of FIXTURES) {
  const name = basename(fixture);
  const dir = join(out, name.replace(/\.[^.]+$/, ''));
  mkdirSync(dir, { recursive: true });
  execFileSync(soffice, ['--headless', '--norestore', '--convert-to', filter, '--outdir', dir, fixture], { stdio: 'ignore', timeout: 300_000 });
  const refPath = join(dir, 'reference.png');
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.png') && f !== 'reference.png' && !f.startsWith('node-')) renameSync(join(dir, f), refPath);
  }
  if (!existsSync(refPath)) throw new Error(`${name}：LibreOffice 未产出参考图`);

  const pres = await lib.parse(new Uint8Array(readFileSync(fixture)), { lazy: false });
  const slide = pres.slides[0];
  // 与 LibreOffice 的对照不受「同一字体」约束：先用注入字体的精确测量，样本字体
  // 缺字时退到与 core 估算同式的确定测量（宿主策略，入口的强制注入不受影响）。
  let measureText;
  const measured = await withFontMeasurement(provider, (measure) => lib.renderSlideSvgInNode(pres, slide, { measureText: measure }),
    { purpose: 'edit', language: 'zh', faceForRun });
  if (measured.ok) measureText = measured.value.measureText;
  else if (measured.reason !== 'missing-glyphs') throw new Error(`${name}：注入测量失败 ${measured.reason}`);
  else {
    measureText = (text, run, scale) => {
      let width = 0;
      const size = run.size * scale * (run.baseline ? 0.65 : 1);
      for (const char of text) width += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(char) ? size : size * 0.55;
      return width + (run.spacing ?? 0) * text.length;
    };
  }
  const png = await lib.renderSlidePngInNode(pres, slide, {
    measureText,
    scale: REF_W / pres.width,
    rasterize: (svg) => new Resvg(svg, { background: 'white' }).render().asPng(),
  });
  pres.dispose?.();
  const nodePng = PNG.sync.read(Buffer.from(png));
  const officePng = PNG.sync.read(readFileSync(refPath));
  writeFileSync(join(dir, 'node-1.png'), Buffer.from(png));
  report.push({ name, page: 1, size: `${nodePng.width}x${nodePng.height}`, ...metrics(nodePng, officePng) });
}
provider.dispose();
writeFileSync(join(out, 'libreoffice-parity.json'), JSON.stringify(report, null, 2) + '\n');
for (const row of report) {
  console.log(`${row.name}：SSIM ${row.ssim} · MAE ${row.mae} · Δmax ${row.deltaMax} · 差异像素 ${row.diffRatioPct}%`);
}
