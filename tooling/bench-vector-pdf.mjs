/**
 * 矢量 PDF 长文稿成本基准：耗时与峰值堆内存。
 *
 * vector-pdf-implementation.md 把「长文稿耗时和峰值内存」列为待测项——能力矩阵里的
 * 入口体积是静态闭包数字，运行期成本必须拿真实长文稿实测。页面由现有固件拼接复制
 * 而成：PDF 逐页生成内容流，页面对象共享不影响耗时与内存的代表性，也不引入新的
 * 非确定性固件。结果落盘 out/vector-pdf/cost.json，供实现文档按实测引用。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { bundleBrowser } from './lib/bundle-browser.mjs';

const root = resolve('.');
const out = resolve(root, 'out/vector-pdf');
mkdirSync(out, { recursive: true });
const PAGES = Number(process.env.VECTOR_PDF_BENCH_PAGES ?? 200);

const entry = resolve(out, 'bench-entry.mjs');
writeFileSync(entry, `export {parse} from '@web-ppt/core';
export {presentationToVectorPdf} from '@web-ppt/core/pdf/vector';
export {createFontProvider,segmentFontText} from '@web-ppt/fonts/glyphs';
export {createHarfBuzzShaper} from '@web-ppt/fonts/glyphs/harfbuzz';`);
const api = await bundleBrowser({ root, entry, output: resolve(out, 'bench-contract.mjs'), aliases: [
  ['@web-ppt/core', resolve(root, 'packages/core/src/index.ts')],
  ['@web-ppt/core/pdf/vector', resolve(root, 'packages/core/src/pdf/vector.ts')],
  ['@web-ppt/fonts/glyphs', resolve(root, 'packages/fonts/src/glyphs/index.ts')],
  ['@web-ppt/fonts/glyphs/harfbuzz', resolve(root, 'packages/fonts/src/glyphs/harfbuzz.ts')],
]});
const hb = await import('harfbuzzjs');
const provider = api.createFontProvider({ loadShaper: async () => api.createHarfBuzzShaper(hb) });
const face = await provider.register({ id: 'latin', origin: 'explicit', bytes: new Uint8Array(readFileSync('tooling/font-glyph-samples/latin.ttf')) }, { purpose: 'view-print' });
if (!face.ok) throw new Error(`字体注册失败：${face.error}`);

const base = await api.parse(new Uint8Array(readFileSync('fixtures/sample-vector-pdf.pptx')));
// 每页深拷贝独立化：共享页对象会被 PDF 侧按引用去重内容流，耗时就不是逐页生成的真实成本；
// 深拷贝发生在计时窗口之外
const slides = [];
for (let i = 0; i < PAGES; i++) {
  const template = base.slides[i % base.slides.length];
  slides.push(typeof structuredClone === 'function' ? structuredClone(template) : JSON.parse(JSON.stringify(template)));
}
const pres = { ...base, slides };

// 导出是纯同步 CPU 循环（无 await 让出），定时采样永远拿不到运行中快照；
// 内存按「导出前后增长量」计口径——V8 堆不主动收缩，增长量即这轮导出的净成本
const before = process.memoryUsage();

const started = performance.now();
const result = await api.presentationToVectorPdf(pres, { fonts: { provider, segmentText: api.segmentFontText } });
const elapsed = performance.now() - started;

const after = process.memoryUsage();
if (result.issues.length) throw new Error(`导出返回 ${result.issues.length} 个问题：${result.issues[0]?.reason}`);

const bytes = new Uint8Array(await result.blob.arrayBuffer());
const mb = (v) => Number((v / 1048576).toFixed(1));
const record = {
  pages: PAGES,
  ms: Math.round(elapsed),
  msPerPage: Number((elapsed / PAGES).toFixed(3)),
  heapGrowthMb: mb(after.heapUsed - before.heapUsed),
  rssGrowthMb: mb(after.rss - before.rss),
  pdfKb: Number((bytes.length / 1024).toFixed(1)),
};
writeFileSync(resolve(out, `cost-${PAGES}.json`), `${JSON.stringify(record, null, 2)}\n`);
console.log(`矢量 PDF ${PAGES} 页：${record.ms}ms（${record.msPerPage}ms/页）· 堆增长 ${record.heapGrowthMb}MB · RSS 增长 ${record.rssGrowthMb}MB · PDF ${record.pdfKb}KB`);
