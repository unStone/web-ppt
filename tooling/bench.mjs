/**
 * 大文件性能基准。
 *
 *   node scripts/bench.mjs [页数倍数]
 *
 * 把 showcase.pptx 的页复制若干遍拼成大文件，测量解析与渲染耗时、内存占用。
 * 真实场景里 200 页 / 数十 MB 的演示文稿很常见，这里给出可复现的数量级参考。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { installDomEnv } from './lib/dom-env.mjs';
import { makeZip } from './lib/ooxml.mjs';

installDomEnv();
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync('npx', ['esbuild', join(root, 'packages/core/src/index.ts'), '--bundle', '--format=esm',
  '--platform=browser', '--log-level=error', `--outfile=${join(root, 'out/core/bench.mjs')}`], { cwd: root });
const lib = await import(`file://${join(root, 'out/core/bench.mjs')}?t=${Date.now()}`);

// 把 showcase 的页复制若干遍拼成大文件
const src = unzipSync(new Uint8Array(readFileSync(join(root, 'fixtures/showcase.pptx'))));
const dec = new TextDecoder();
const REPEAT = Number(process.argv[2] ?? 30);
const entries = [];
const slideXmls = [];
for (let i = 1; i <= 7; i++) slideXmls.push(dec.decode(src[`ppt/slides/slide${i}.xml`]));
const slideRels = dec.decode(src['ppt/slides/_rels/slide1.xml.rels']);
let n = 0;
const sldIds = [], presRels = [];
for (let r = 0; r < REPEAT; r++) {
  for (let i = 0; i < 7; i++) {
    n++;
    entries.push([`ppt/slides/slide${n}.xml`, slideXmls[i]]);
    entries.push([`ppt/slides/_rels/slide${n}.xml.rels`, dec.decode(src[`ppt/slides/_rels/slide${i+1}.xml.rels`]) ]);
    sldIds.push(`<p:sldId id="${255+n}" r:id="rId${n+1}"/>`);
    presRels.push(`<Relationship Id="rId${n+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n}.xml"/>`);
  }
}
for (const [k,v] of Object.entries(src)) {
  if (/^ppt\/slides\//.test(k)) continue;
  if (k === 'ppt/presentation.xml' || k === 'ppt/_rels/presentation.xml.rels' || k === '[Content_Types].xml') continue;
  entries.push([k, v]);
}
let pres = dec.decode(src['ppt/presentation.xml']);
pres = pres.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${sldIds.join('')}</p:sldIdLst>`);
entries.push(['ppt/presentation.xml', pres]);
let rels = dec.decode(src['ppt/_rels/presentation.xml.rels']);
rels = rels.replace(/<Relationship Id="rId(?!1")[^>]*Target="slides\/[^>]*>/g, '');
rels = rels.replace('</Relationships>', presRels.join('') + '</Relationships>');
entries.push(['ppt/_rels/presentation.xml.rels', rels]);
let ct = dec.decode(src['[Content_Types].xml']);
ct = ct.replace(/<Override PartName="\/ppt\/slides\/[^>]*>/g, '');
ct = ct.replace('</Types>', Array.from({length:n},(_,i)=>`<Override PartName="/ppt/slides/slide${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('') + '</Types>');
entries.push(['[Content_Types].xml', ct]);

const big = makeZip(entries);
writeFileSync(join(root, 'out/core/big.pptx'), big);
console.log(`大文件：${n} 页，${(big.length/1024/1024).toFixed(1)} MB`);

const t0 = Date.now();
const p = await lib.parse(big);
const parseMs = Date.now() - t0;
let els = 0;
const walk = (l) => { for (const e of l) { els++; if (e.kind==='group') walk(e.children); } };
for (const s of p.slides) walk(s.elements);

const t1 = Date.now();
for (const s of p.slides) lib.renderSlideToSvg(p, s);
const renderAll = Date.now() - t1;

const t2 = Date.now();
lib.renderSlideToSvg(p, p.slides[0]);
const renderOne = Date.now() - t2;

console.log(`  解析 ${p.slides.length} 页 / ${els} 元素: ${parseMs}ms  (${(parseMs / p.slides.length).toFixed(1)}ms/页)`);
console.log(`  全部渲染: ${renderAll}ms  (${(renderAll / p.slides.length).toFixed(1)}ms/页)`);
console.log(`  单页渲染: ${renderOne}ms`);

// 区分「峰值垃圾」与「真正驻留」：前者无害，后者才是大文件的隐患。
// 需要 --expose-gc 才能强制回收；没有就只报峰值。
const peak = process.memoryUsage().heapUsed;
if (typeof global.gc === 'function') {
  global.gc();
  global.gc();
  const retained = process.memoryUsage().heapUsed;
  console.log(`  堆内存: 峰值 ${(peak / 1024 / 1024).toFixed(0)} MB · 回收后驻留 ${(retained / 1024 / 1024).toFixed(0)} MB` +
    `  (${(retained / 1024 / 1024 / p.slides.length).toFixed(2)} MB/页)`);
} else {
  console.log(`  堆内存: 峰值 ${(peak / 1024 / 1024).toFixed(0)} MB（加 --expose-gc 可测驻留量）`);
}
console.log('  注：Node 侧用 jsdom 解析 XML，内存显著高于浏览器原生 DOMParser，仅作趋势参考。');
