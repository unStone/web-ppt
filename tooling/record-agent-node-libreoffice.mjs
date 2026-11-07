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
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { PNG } from 'pngjs';
import * as hb from 'harfbuzzjs';
import { grayFromRgba, grayMetrics } from './lib/ssim-metrics.mjs';
import { requireSoffice } from './lib/soffice.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'out/agent-node-render/libreoffice');
mkdirSync(out, { recursive: true });

const soffice = requireSoffice();

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

/** SSIM 与像素指标统一走 lib/ssim-metrics.mjs，与 compare.html 同一份实现。 */

const report = [];
for (const fixture of FIXTURES) {
  const name = basename(fixture);
  const dir = join(out, name.replace(/\.[^.]+$/, ''));
  mkdirSync(dir, { recursive: true });
  const refPath = join(dir, 'reference.png');
  // 先清掉上一轮的参考图（必须在转换前）：转换静默失败时绝不能拿陈旧参考图继续算指标
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.png') && !f.startsWith('node-')) unlinkSync(join(dir, f));
  }
  execFileSync(soffice, ['--headless', '--norestore', '--convert-to', filter, '--outdir', dir, fixture], { stdio: 'ignore', timeout: 300_000 });
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.png') && !f.startsWith('node-')) renameSync(join(dir, f), refPath);
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
  const w = Math.min(nodePng.width, officePng.width), h = Math.min(nodePng.height, officePng.height);
  const m = grayMetrics(grayFromRgba(nodePng.data, w, h), grayFromRgba(officePng.data, w, h), w, h);
  report.push({ name, page: 1, size: `${nodePng.width}x${nodePng.height}`, ...m });
}
provider.dispose();
writeFileSync(join(out, 'libreoffice-parity.json'), JSON.stringify(report, null, 2) + '\n');
for (const row of report) {
  console.log(`${row.name}：SSIM ${row.ssim} · MAE ${row.mae} · Δmax ${row.deltaMax} · 差异像素 ${row.diffRatioPct}%`);
}
