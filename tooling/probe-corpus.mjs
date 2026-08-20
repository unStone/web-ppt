/**
 * 拿 corpus/ 里的真实文件跑批：解析 → 全页渲染 → 统计。
 *
 * 自己造的固件只能覆盖自己想到的情况，这批文件覆盖的是别人踩过的坑。
 *
 * 判「渲染出错」时必须先剔掉所有 data: URI 再找 NaN —— 图片是 base64，
 * 里面随机出现 NaN 三个字母纯属巧合，而且 URL 编码的 SVG 里还会再嵌一层
 * base64 PNG，只剔一层会漏。用错的检测手段比不检测更糟：它给你虚假的安全感。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, renderSlideToSvg } from '../packages/core/dist/core.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(ROOT, 'corpus', process.argv[2] ?? 'poi');

if (!existsSync(dir)) {
  console.error(`没有 ${dir}，先跑 npm run corpus`);
  process.exit(1);
}

const files = readdirSync(dir).filter((f) => /\.pptx?$/i.test(f)).sort();
const ok = [];
const failed = [];
const dirty = [];
const unsupported = new Map();
let slides = 0;
let elements = 0;

const t0 = performance.now();

for (const name of files) {
  const buf = readFileSync(join(dir, name));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

  let pres;
  try {
    pres = await parse(ab);
  } catch (e) {
    failed.push({ name, why: e.message });
    continue;
  }

  slides += pres.slides.length;
  let bad = 0;

  const walk = (els = []) => {
    for (const el of els) {
      elements++;
      if (el.kind === 'unsupported') {
        unsupported.set(el.label, (unsupported.get(el.label) ?? 0) + 1);
      }
      if (el.children) walk(el.children);
    }
  };

  for (const s of pres.slides) {
    walk(s.elements);
    try {
      const svg = renderSlideToSvg(s && pres, s);
      if (/NaN|Infinity/.test(svg.replace(/data:[^"')]*/g, ''))) bad++;
    } catch {
      bad++;
    }
  }

  if (bad) dirty.push({ name, bad, pages: pres.slides.length });
  else ok.push(name);
}

const ms = performance.now() - t0;
const mb = files.reduce((a, f) => a + statSync(join(dir, f)).size, 0) / 1048576;

console.log(`\n语料: ${files.length} 个文件 / ${mb.toFixed(0)}MB  耗时 ${(ms / 1000).toFixed(1)}s`);
console.log(`解析成功 ${ok.length + dirty.length} / ${files.length}`);
console.log(`渲染干净 ${ok.length}，有问题 ${dirty.length}，解析失败 ${failed.length}`);
console.log(`共 ${slides} 页 / ${elements} 个元素`);

if (failed.length) {
  console.log(`\n解析失败（故意损坏的文件能干净报错也算对）：`);
  const why = new Map();
  for (const f of failed) why.set(f.why, [...(why.get(f.why) ?? []), f.name]);
  for (const [w, ns] of [...why].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${ns.length.toString().padStart(3)}  ${w}`);
    for (const n of ns.slice(0, 3)) console.log(`         ${n}`);
    if (ns.length > 3) console.log(`         … 还有 ${ns.length - 3} 个`);
  }
}

if (dirty.length) {
  console.log(`\n⚠ 渲染有问题：`);
  for (const d of dirty) console.log(`  ${d.name}  ${d.bad}/${d.pages} 页`);
}

if (unsupported.size) {
  console.log(`\n未支持的元素（降级为占位框）：`);
  for (const [k, v] of [...unsupported].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v.toString().padStart(4)}  ${k}`);
  }
}

process.exit(dirty.length ? 1 : 0);
