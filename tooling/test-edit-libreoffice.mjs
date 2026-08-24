/** 用真实办公软件打开补丁保存产物，避免只证明“自己的解析器能读自己的输出”。 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { bundleBrowser } from './lib/bundle-browser.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out/edit-libreoffice');
mkdirSync(out, { recursive: true });

async function generateSavedPath() {
  const core = await bundleBrowser({
    root, entry: join(root, 'packages/core/src/index.ts'), output: join(out, 'core.mjs'),
  });
  const aliases = [
    ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
    ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
  ];
  const edit = await bundleBrowser({
    root, entry: join(root, 'packages/edit-core/src/index.ts'), output: join(out, 'edit.mjs'), aliases,
  });
  const sourceBytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-edit-xfrm.pptx')));
  const pres = await core.parse(sourceBytes, { edit: true, keepPackage: true, lazy: false, assets: 'defer' });
  const doc = edit.createDoc(pres, { idPrefix: 'libreoffice-' });
  const target = Object.values(doc.elements).find((record) => record.src.name === '异名前缀形状');
  if (!target) throw new Error('LibreOffice 固件缺少 SetXfrm 目标');
  const editor = new edit.Editor(doc);
  editor.exec({
    type: 'SetXfrm', id: target.id, x: target.src.x + 17.25, y: target.src.y + 8.5, rot: 11,
  });
  const saved = await editor.saveDetailed();
  const path = join(out, 'saved.pptx');
  writeFileSync(path, saved.bytes);
  edit.disposeDoc(doc);
  return path;
}

const requested = process.argv[2];
const savedPath = requested
  ? (isAbsolute(requested) ? requested : resolve(root, requested))
  : await generateSavedPath();
if (!existsSync(savedPath)) throw new Error(`找不到待验证的保存产物：${savedPath}`);

const candidates = [
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/bin/soffice',
  '/usr/local/bin/soffice',
];
const soffice = candidates.find((candidate) => existsSync(candidate));
if (!soffice) throw new Error('未找到 LibreOffice；CI 与本地验收必须安装 soffice');

function savedShapeGeometry(bytes, name) {
  const parts = unzipSync(bytes);
  const decode = (part) => new TextDecoder().decode(parts[part]);
  const slide = decode('ppt/slides/slide1.xml');
  const named = slide.indexOf(`name="${name}"`);
  const from = slide.lastIndexOf('<p:sp>', named);
  const to = slide.indexOf('</p:sp>', named);
  const fragment = from >= 0 && to >= 0 ? slide.slice(from, to + 7) : '';
  const xfrm = fragment.match(/<a:xfrm\b([^>]*)>[\s\S]*?<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/);
  const size = decode('ppt/presentation.xml').match(/<p:sldSz cx="(\d+)" cy="(\d+)"\/>/);
  if (!xfrm || !size) throw new Error('无法从保存产物读取 spAutoFit 的 xfrm 或画布尺寸');
  return {
    x: Number(xfrm[2]), y: Number(xfrm[3]), w: Number(xfrm[4]), h: Number(xfrm[5]),
    rot: Number(xfrm[1].match(/\brot="(-?\d+)"/)?.[1] ?? 0) / 60000,
    slideW: Number(size[1]), slideH: Number(size[2]),
  };
}

function expectedBounds(frame, viewW, viewH) {
  const radians = frame.rot * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const points = [[frame.x, frame.y], [frame.x + frame.w, frame.y],
    [frame.x + frame.w, frame.y + frame.h], [frame.x, frame.y + frame.h]].map(([x, y]) => ({
    x: cx + (x - cx) * cos - (y - cy) * sin,
    y: cy + (x - cx) * sin + (y - cy) * cos,
  }));
  return {
    left: Math.min(...points.map((point) => point.x)) / frame.slideW * viewW,
    right: Math.max(...points.map((point) => point.x)) / frame.slideW * viewW,
    top: Math.min(...points.map((point) => point.y)) / frame.slideH * viewH,
    bottom: Math.max(...points.map((point) => point.y)) / frame.slideH * viewH,
  };
}

const pdf = join(out, `${basename(savedPath, extname(savedPath))}.pdf`);
if (existsSync(pdf)) unlinkSync(pdf);
const opened = spawnSync(soffice, [
  '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', out, savedPath,
], { cwd: root, encoding: 'utf8', timeout: 300_000 });
if (opened.error) throw opened.error;
if (opened.status !== 0) {
  const termination = opened.signal ? `信号 ${opened.signal}` : `退出码 ${opened.status}`;
  throw new Error(`LibreOffice 打开失败（${termination}）：${opened.stderr || opened.stdout}`);
}
const diagnostics = `${opened.stdout}\n${opened.stderr}`;
if (/\b(repair(?:ed)?|recover(?:ed|y)?|corrupt(?:ed)?|damaged)\b/i.test(diagnostics)) {
  throw new Error(`LibreOffice 报告修复或恢复：${diagnostics.trim()}`);
}
if (!existsSync(pdf) || statSync(pdf).size === 0) throw new Error('LibreOffice 未生成有效 PDF');

let geometryEvidence = '';
if (basename(savedPath) === 'shape-autofit-text-editing.pptx') {
  const svg = join(out, 'shape-autofit-text-editing.svg');
  if (existsSync(svg)) unlinkSync(svg);
  const exported = spawnSync(soffice, [
    '--headless', '--norestore', '--convert-to', 'svg', '--outdir', out, savedPath,
  ], { cwd: root, encoding: 'utf8', timeout: 300_000 });
  if (exported.error) throw exported.error;
  if (exported.status !== 0 || !existsSync(svg)) {
    throw new Error(`LibreOffice 未导出 spAutoFit 几何 SVG：${exported.stderr || exported.stdout}`);
  }
  const markup = readFileSync(svg, 'utf8');
  const viewBox = markup.match(/\bviewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const pathTag = markup.match(/<path\b[^>]*>/g)?.find((tag) => {
    const compact = tag.replace(/\s+/g, '').toLowerCase();
    return compact.includes('fill="rgb(217,234,247)"') || compact.includes('fill="#d9eaf7"');
  });
  const pathData = pathTag?.match(/\bd="([^"]+)"/)?.[1];
  if (!viewBox || !pathData) throw new Error('LibreOffice SVG 缺少唯一 spAutoFit 形状或 viewBox');
  const coordinates = pathData.match(/-?[\d.]+/g)?.map(Number) ?? [];
  if (coordinates.length < 8 || coordinates.length % 2) throw new Error('LibreOffice spAutoFit path 坐标无效');
  const xs = coordinates.filter((_, index) => index % 2 === 0);
  const ys = coordinates.filter((_, index) => index % 2 === 1);
  const actual = {
    left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys),
  };
  const expected = expectedBounds(
    savedShapeGeometry(new Uint8Array(readFileSync(savedPath)), 'sp-autofit-rotated'),
    Number(viewBox[1]), Number(viewBox[2]),
  );
  const error = Math.max(...Object.keys(actual)
    .map((key) => Math.abs(actual[key] - expected[key])));
  // LibreOffice 的 SVG 坐标是 1/100 mm 整数，旋转后四边各自会有约 2.5 unit 的量化误差。
  if (error > 3) throw new Error(`LibreOffice spAutoFit 渲染几何偏差 ${error.toFixed(3)} SVG unit`);
  geometryEvidence = `，spAutoFit frame 最大偏差 ${error.toFixed(3)} SVG unit`;
}

console.log(`\n\x1b[32m✓ LibreOffice 已打开 ${basename(savedPath)} 并导出 PDF（${statSync(pdf).size} bytes${geometryEvidence}）\x1b[0m`);
