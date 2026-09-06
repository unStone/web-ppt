import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { chartXml, kinds, nativeFixture } from './lib/chartex-native-fixture.mjs';
import { nativeSaveContract, nativeContextContract } from './lib/chartex-native-save-contract.mjs';
import { recordCount } from './lib/measured.mjs';
const root = resolve('.'), out = resolve('out/chartex-native');
mkdirSync(out, { recursive: true });
const entry = resolve(out, 'entry.mjs');
// core 是 edit-core 的 peer；同一构建图才能检验包句柄与插件的真实生命周期。
writeFileSync(entry, Object.entries({ core: 'core/src/index.ts', cx: 'core/src/chart-ex.ts', xml: 'core/src/xml.ts', model: 'core/src/chart-ex/model.ts', tree: 'core/src/chart-ex/hierarchy.ts', stats: 'core/src/chart-ex/statistics.ts', edit: 'edit-core/src/index.ts' })
  .map(([name, path]) => `export * as ${name} from ${JSON.stringify(resolve('packages', path))};`).join('\n'));
const { core, cx, xml, model, tree, stats, edit } = await bundleBrowser({ root, entry, output: resolve(out, 'contract.mjs'), aliases: [['@web-ppt/core/geometry/handles', resolve('packages/core/src/geometry/handles/index.ts')], ['@web-ppt/core/geometry', resolve('packages/core/src/geometry/index.ts')], ['@web-ppt/core', resolve('packages/core/src/index.ts')]] });
const env = { ctx: { theme: { dk1: '000000', lt1: 'FFFFFF', accent1: '4472C4', accent2: 'ED7D31', accent3: '70AD47' }, clrMap: { tx1: 'dk1' } }, fonts: { minor: { latin: 'Arial', ea: null }, major: { latin: 'Arial', ea: null } }, rels: {} };
let passed = 0;
const check = (name, fn) => { try {
  fn();
  passed++;
}
catch (error) {
  throw new Error(name, { cause: error });
} };
const read = (kind, options) => model.readModel(xml.parseXml(chartXml(kind, options)), env);
check('确定性生成两次字节一致', () => assert.deepEqual(nativeFixture(), nativeFixture()));
const bytes = nativeFixture();
const fallback = await core.parse(bytes, { lazy: false, edit: true });
check('未启用入口时八页全部为 Office 预览', () => assert.deepEqual(fallback.slides.map((s) => s.elements[0].kind), kinds.map(() => 'image')));
fallback.dispose();
core.setChartExParser(cx.parseChartEx);
const lazyNative = await core.parse(bytes);
core.setChartExParser(null);
const lazyFallback = await core.parse(bytes);
check('关闭全局 hook 不改变已打开的惰性文稿', () => assert.equal(lazyNative.slides[1].elements[0].kind, 'group'));
core.setChartExParser(cx.parseChartEx);
check('启用全局 hook 不改变此前的惰性回退文稿', () => assert.equal(lazyFallback.slides[1].elements[0].kind, 'image'));
lazyNative.dispose();
lazyFallback.dispose();
const presentation = await core.parse(bytes, { lazy: false, edit: true, keepPackage: true });
for (const [i, kind] of kinds.entries()) {
  const element = presentation.slides[i].elements[0];
  check(`${kind} 原生/地图回退选择`, () => assert.equal(element.kind, kind === 'regionMap' ? 'image' : 'group'));
  check(`${kind} 保持原子整壳身份`, () => { assert.equal(element.id, 6); assert.equal(element.editInfo.editable, 'frame'); assert.equal(element.editInfo.requiresOriginal, true); });
  for (const textMode of ['html', 'svg']) {
    const svg = core.renderSlideToSvg(presentation, presentation.slides[i], { textMode });
    check(`${kind}/${textMode} 没有非有限坐标或占位`, () => assert(!/NaN|Infinity|不支持/.test(svg)));
    writeFileSync(resolve(out, `${kind}-${textMode}.svg`), svg);
  }
}
const invalid = [
  ['重复索引', chartXml('funnel').replace('idx="1"', 'idx="0"')],
  ['超大点数', chartXml('funnel').replace('ptCount="10"', 'ptCount="999999999"')],
  ['空数值不是零', chartXml('funnel').replace('<cx:pt idx="0">1</cx:pt>', '<cx:pt idx="0"></cx:pt>')],
  ['错误命名空间', chartXml('funnel').replaceAll('drawing/2014/chartex', 'drawing/9999/chartex')],
  ['未知类型', chartXml('regionMap')],
  ['负漏斗', chartXml('funnel', { values: [10, -1, 2] })],
  ['全空图表', chartXml('funnel', { values: [null, null] })],
  ['Pareto 归属错误', chartXml('pareto').replace('ownerIdx="0"', 'ownerIdx="99"')],
  ['层级权重下溢保持回退', chartXml('sunburst', { values: [1e308, 1e-300, 1e-300], categories: [['A', 'B', 'C'], ['Big', 'Tiny', 'Tiny']] })],
];
for (const [name, source] of invalid)
  check(name, () => assert.deepEqual(cx.renderChartExXml(source, 580, 360, env), []));
const hierarchy = tree.hierarchy(read('treemap').series[0]);
check('跨分支同名叶保持独立', () => assert.deepEqual(hierarchy.children.map((n) => n.name), ['North', 'South']));
check('父空白继承且末端空白不继承叶', () => assert.deepEqual(hierarchy.children[1].children.map((n) => [n.name, n.children.map((c) => c.name)]), [['Alpha', ['A', 'C']], ['Beta', []]]));
check('错误父路径拒绝', () => assert.throws(() => tree.hierarchy(read('treemap', { categories: [['A', 'B'], ['Alpha', null], ['North', 'South']], values: [1, 2] }).series[0])));
check('同路径重复拒绝', () => assert.throws(() => tree.hierarchy(read('treemap', { categories: [['A', 'A']], values: [1, 2] }).series[0])));
for (const [w, h] of [[600, 400], [1, 1000], [1000, 1]]) {
  const tiles = tree.squarify(hierarchy.children, { x: 0, y: 0, w, h });
  check(`squarify 面积守恒 ${w}×${h}`, () => assert(Math.abs(tiles.reduce((n, t) => n + t.rect.w * t.rect.h, 0) - w * h) < 1e-7));
  check(`squarify 有界 ${w}×${h}`, () => assert(tiles.every(({ rect: r }) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w + 1e-8 && r.y + r.h <= h + 1e-8)));
}
check('单分支旭日覆盖整圆', () => { const layout = tree.sunburst(tree.hierarchy(read('sunburst', { categories: [['A']], values: [3] }).series[0])); assert.equal(layout.sectors[0].end - layout.sectors[0].start, Math.PI * 2); });
check('箱线 exclusive/inclusive 中位数规则', () => { const values = [1, 2, 3, 4, 5, 6, 7, 8, 30]; const a = stats.boxSummary(values, 'exclusive'), b = stats.boxSummary(values, 'inclusive'); assert.deepEqual([a.q1, a.median, a.q3, a.low, a.high, a.outliers], [2.5, 5, 7.5, 1, 8, [30]]); assert.deepEqual([b.q1, b.q3], [3, 7]); });
check('常量箱线保持有限', () => assert.equal(stats.boxSummary([4, 4, 4], 'exclusive').mean, 4));
check('固定分箱不丢边界观测', () => { const bins = stats.histogram(read('histogram').series[0]); assert.deepEqual(bins.map((b) => b.count), [6, 3, 0, 1]); });
check('左闭分箱最大值进入包含它的区间', () => { const bins = stats.histogram(read('histogram', { values: [1, 3, 5], layout: '<cx:binning intervalClosed="l"><cx:binSize>2</cx:binSize></cx:binning>' }).series[0]); assert.deepEqual(bins.map((b) => b.count), [1, 1, 1]); assert.equal(bins[2].lo, 5); });
check('左闭分箱与 overflow 交界的标签和计数一致', () => {
  const bins = stats.histogram(read('histogram', { values: [1, 3, 5, 6], layout: '<cx:binning intervalClosed="l" overflow="5"><cx:binCount>2</cx:binCount></cx:binning>' }).series[0]);
  assert.deepEqual(bins.map((b) => [b.label, b.count]), [['[1, 3)', 1], ['[3, 5]', 2], ['> 5', 1]]);
});
check('左右闭合与上下溢出交界无丢失或重计', () => {
  for (const closed of ['l', 'r']) {
    const bins = stats.histogram(read('histogram', { values: [-1, 0, 1, 2, 3, 4, 5], layout: `<cx:binning intervalClosed="${closed}" underflow="0" overflow="4"><cx:binSize>2</cx:binSize></cx:binning>` }).series[0]);
    assert.deepEqual(bins.map((b) => b.count), closed === 'l' ? [2, 1, 3, 1] : [2, 2, 2, 1]);
  }
});
check('隐藏异常点后可见均值仍在画布内', () => { const els = cx.renderChartExXml(chartXml('boxWhisker', { values: [1, 1, 1, 1, 1000], layout: '<cx:visibility outliers="0" meanMarker="1"/><cx:statistics quartileMethod="inclusive"/>' }), 580, 360, env); assert(els.length > 0); assert(els.every((el) => el.y >= 0 && el.y + el.h <= 361)); });
check('图例在原生 Schema 中可见', () => { const source = chartXml('funnel').replace('</cx:chart>', '<cx:legend pos="t"/></cx:chart>'); assert(cx.renderChartExXml(source, 580, 360, env).some((el) => el.text?.paragraphs.some((p) => p.runs.some((r) => r.text === 'Series 1')))); });
check('树状图面积排序不改变图例的类别颜色', () => {
  const source = chartXml('treemap', { values: [1, 10], categories: [['A', 'B']] }).replace('</cx:chart>', '<cx:legend pos="t"/></cx:chart>');
  const els = cx.renderChartExXml(source, 580, 360, env);
  const fills = els.filter((el) => el.kind === 'shape' && !el.text).map((el) => el.fill);
  assert.equal(fills.length, 5);
  assert.deepEqual(fills[1], fills[4]);
  assert.deepEqual(fills[2], fills[3]);
});
check('瀑布小计重置基线', () => assert.deepEqual(stats.waterfall(read('waterfall').series[0]).map((s) => [s.from, s.to]), [[0, 10], [10, 7], [7, 13], [13, 11], [0, 11]]));
await nativeContextContract({ core, edit, parser: cx.parseChartEx, bytes, check });
await nativeSaveContract({ core, edit, bytes, out, check });
const directParts = unzipSync(bytes);
directParts['ppt/slides/slide1.xml'] = strToU8(strFromU8(directParts['ppt/slides/slide1.xml'])
  .replace(/<mc:AlternateContent[^>]*><mc:Choice[^>]*>([\s\S]*?)<\/mc:Choice><mc:Fallback>[\s\S]*?<\/mc:Fallback><\/mc:AlternateContent>/, '$1'));
const direct = await core.parse(zipSync(directParts), { lazy: false, edit: true, keepPackage: true });
const directEditor = new edit.Editor(edit.createDoc(direct));
check('没有 MC 外壳的原生 ChartEx 保留生成保存来源', () => assert.equal(direct.slides[0].elements[0].editInfo.requiresOriginal, true));
direct.dispose();
const directSaved = await core.parse(await directEditor.save(), { lazy: false });
check('直接图表框架在原包释放后仍可原生重开', () => assert.equal(directSaved.slides[0].elements[0].kind, 'group'));
directSaved.dispose();
directEditor.dispose();
if (process.argv.includes('--corpus')) {
  const realPath = resolve('corpus/chartex/libreoffice-funnel-pp1.pptx');
  assert(existsSync(realPath), '--corpus 需要哈希锁定的真实来源文件');
  const realBytes = readFileSync(realPath);
  const real = await core.parse(realBytes, { lazy: false, edit: true });
  check('真实 PowerPoint 漏斗采用原生 Schema', () => assert(real.slides.some((s) => s.elements.some((el) => el.id === 6 && el.kind === 'group'))));
  const parts = unzipSync(realBytes);
  const rootXml = xml.parseXml(strFromU8(parts['ppt/charts/chartEx1.xml']));
  const workbookPart = Object.keys(parts).find((name) => name.endsWith('.xlsx'));
  const realEnv = { ...env, rels: { rId1: { type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/package', target: workbookPart } }, readPart: (path) => parts[path] };
  check('隐藏系列不混入真实漏斗', () => { const m = model.readModel(rootXml, realEnv); assert.equal(m.series.length, 1); assert.deepEqual(m.series[0].values, [4.3, 2.5, 3.5, 4.5]); });
  check('真实缓存与内嵌工作簿冲突时拒绝原生', () => { const source = strFromU8(parts['ppt/charts/chartEx1.xml']).replace('4.2999999999999998', '400'); assert.deepEqual(cx.renderChartExXml(source, 580, 360, realEnv), []); });
  real.dispose();
}
presentation.dispose();
core.setChartExParser(null);
if (!process.argv.includes('--corpus')) recordCount('chartexNative', passed);
console.log(`ChartEx 原生专项通过（${passed} 项）`);
