import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { countedAssert } from './lib/counted-assert.mjs';
import { testSharedCollaboration } from './lib/chart-shared-collab-contract.mjs';
import { testSharedBoundaries } from './lib/chart-shared-boundaries-contract.mjs';
import { testSharedViews } from './lib/chart-shared-views-contract.mjs';
import { testSharedMatrix } from './lib/chart-shared-matrix-contract.mjs';
import { testSharedRows } from './lib/chart-shared-rows-contract.mjs';
import { testSharedLoading } from './lib/chart-shared-loading-contract.mjs';
import { testSharedSeries } from './lib/chart-shared-series-contract.mjs';
import { testSharedNativeParts } from './lib/chart-shared-native-contract.mjs';
import { testSharedCache } from './lib/chart-shared-cache-contract.mjs';
import { testSharedCacheXY } from './lib/chart-shared-cache-xy-contract.mjs';
import { testSharedCacheNative } from './lib/chart-shared-cache-native-contract.mjs';
import { testSharedCacheCollaboration } from './lib/chart-shared-cache-collab-contract.mjs';
import { testSharedCacheBoundaries } from './lib/chart-shared-cache-boundaries-contract.mjs';
import { testSharedCacheHierarchy } from './lib/chart-shared-cache-hierarchy-contract.mjs';
import { testSharedCacheHierarchyBoundaries } from './lib/chart-shared-cache-hierarchy-boundaries-contract.mjs';
import { testSharedSourceXY } from './lib/chart-shared-source-xy-contract.mjs';
import { testSharedSourceXYViews } from './lib/chart-shared-source-xy-views-contract.mjs';
import { testSharedSourceXYCollaboration } from './lib/chart-shared-source-xy-collab-contract.mjs';
import { testSharedSourceXYBoundaries } from './lib/chart-shared-source-xy-boundaries-contract.mjs';
import { testSharedSourceXYRebuild } from './lib/chart-shared-source-xy-rebuild-contract.mjs';
import { testSharedSources } from './lib/chart-shared-source-contract.mjs';
import { testSharedRoundTrips } from './lib/chart-shared-roundtrip-contract.mjs';
import { testSharedGrowth } from './lib/chart-shared-growth-contract.mjs';
import { testSharedGrowthCollaboration } from './lib/chart-shared-growth-collab-contract.mjs';
import { testSharedGrowthBoundaries } from './lib/chart-shared-growth-boundaries-contract.mjs';
import { testSharedXYGrowth } from './lib/chart-shared-growth-xy-contract.mjs';
import { testSharedCategoryGrowth } from './lib/chart-shared-category-growth-contract.mjs';
import { testSharedCategoryGrowthCollaboration } from './lib/chart-shared-category-growth-collab-contract.mjs';
import { testSharedCategoryGrowthBoundaries } from './lib/chart-shared-category-growth-boundaries-contract.mjs';
import { testSharedTransition } from './lib/chart-shared-transition-contract.mjs';
import { testSharedTransitionCollaboration } from './lib/chart-shared-transition-collab-contract.mjs';
import { testSharedSinglePart } from './lib/chart-shared-single-part-contract.mjs';
import { testDocumentExtensions } from './lib/document-extension-contract.mjs';
import { testSharedClipboard } from './lib/chart-shared-clipboard-contract.mjs';
import { testSharedClipboardCollaboration } from './lib/chart-shared-clipboard-collab-contract.mjs';
import { testSharedGroupedClipboard } from './lib/chart-shared-grouped-clipboard-contract.mjs';
import { testSharedMixed } from './lib/chart-shared-mixed-contract.mjs';
import { testSharedMixedCollaboration } from './lib/chart-shared-mixed-collab-contract.mjs';
import { testSharedJoint } from './lib/chart-shared-joint-contract.mjs';
import { testSharedJointCollaboration } from './lib/chart-shared-joint-collab-contract.mjs';
import { testSharedJointRebuild } from './lib/chart-shared-joint-rebuild-contract.mjs';
import { testSharedTopology } from './lib/chart-shared-topology-contract.mjs';
import { testSharedMixedAxes } from './lib/chart-shared-mixed-axes-contract.mjs';
import { testSharedMixedRendering } from './lib/chart-shared-mixed-render-contract.mjs';

const { assert, record } = countedAssert('chartShared');
const root = resolve('.'), out = join(root, 'out/chart-shared');
mkdirSync(out, { recursive: true });
for (const { stem } of JSON.parse(readFileSync('tooling/chart-shared-cases.json', 'utf8'))) {
  for (const mode of ['patched', 'generated']) rmSync(join(out, `${stem}-${mode}.pptx`), { force: true });
}
writeFileSync(join(out, 'entry.mjs'), `export * as core from '@web-ppt/core';export { renderChartXml } from '@web-ppt/core/chart-edit';
export * as edit from '@web-ppt/edit-core';export * as chart from '@web-ppt/edit-core/chart-shared';
export * as generate from '@web-ppt/edit-core/generate';
export * as chartDesign from '@web-ppt/edit-core/chart-design';
export * as basicChart from '@web-ppt/edit-core/chart';export * as collab from '@web-ppt/collab';`);
const { core, edit, chart, collab, basicChart, chartDesign, generate, renderChartXml } = process.argv.includes('--dist') ? {
  renderChartXml: (await import('@web-ppt/core/chart-edit')).renderChartXml,
  core: await import('@web-ppt/core'), edit: await import('@web-ppt/edit-core'),
  chart: await import('@web-ppt/edit-core/chart-shared'), collab: await import('@web-ppt/collab'),
  basicChart: await import('@web-ppt/edit-core/chart'),
  chartDesign: await import('@web-ppt/edit-core/chart-design'),
  generate: await import('@web-ppt/edit-core/generate'),
} : await bundleBrowser({ root, entry: join(out, 'entry.mjs'),
  output: join(out, 'contract.mjs'), aliases: [
    ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
    ['@web-ppt/edit-core', join(root, 'packages/edit-core/src/index.ts')],
    ['@web-ppt/collab', join(root, 'packages/collab/src/index.ts')],
  ] });
await testDocumentExtensions({ core, edit, input: readFileSync('fixtures/sample-chart-shared.pptx'), assert });
await testSharedLoading({ core, edit, chart, basicChart, input: readFileSync('fixtures/sample-chart-shared.pptx'), assert });
await testSharedClipboard({ core, edit, chart, chartDesign, generate, assert });
await testSharedClipboardCollaboration({ core, edit, chart, collab, assert });
await testSharedGroupedClipboard({ core, edit, chart, assert });
await testSharedMixed({ core, edit, chart, assert });
await testSharedMixedRendering({ core, edit, chart, assert });
testSharedMixedAxes({ renderChartXml, assert });
await testSharedMixedCollaboration({ core, edit, chart, collab, assert });
await testSharedJoint({ core, edit, chart, assert });
await testSharedJointCollaboration({ core, edit, chart, collab, assert });
await testSharedJointRebuild({ core, edit, chart, assert });
await testSharedTopology({ core, edit, chart, generate, assert });
const presentation = await core.parse(readFileSync('fixtures/sample-chart-shared.pptx'),
  { edit: true, keepPackage: true, lazy: false });
const editor = new edit.Editor(edit.createDoc(presentation));
const charts = chart.listEditableCharts(editor.doc);
assert.equal(charts.length, 3);
assert.deepEqual(charts.map(item => item.binding.mode), ['workbook', 'workbook', 'workbook'],
  '两个图表部件与三个框架共同编辑一个内嵌工作簿');
const api = chart.createChartDataEditor(editor), first = chart.queryChartData(editor.doc, charts[0].id);
const before = charts.map(item => JSON.stringify(editor.effectiveElement(item.id)));
const changes = [];
const recoveryFrames = [];
editor.subscribe(change => changes.push(change));
editor.subscribeRecovery(frame => recoveryFrames.push(frame));
api.setPoint(charts[0].id, first.series[0].id, first.series[0].points[1].id, { value: 777 });
assert.deepEqual(charts.map(item => chart.queryChartData(editor.doc, item.id).series[0].points[1].value),
  [777, 777, 777], '共享单元格的一次修改更新全部关联图表');
assert.ok(charts.every((item, index) => JSON.stringify(editor.effectiveElement(item.id)) !== before[index]),
  '文档级编辑使三个框架的已缓存投影同时失效');
assert.ok(charts.every(item => changes.at(-1).renderElements.has(item.id)), '同一通知要求视图层重绘全部关联框架');
editor.undo();
assert.deepEqual(charts.map(item => chart.queryChartData(editor.doc, item.id).series[0].points[1].value),
  [10, 10, 10], '一次撤销恢复所有视图');
editor.redo();
const removed = [...charts].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)[0];
editor.exec({ type: 'RemoveElement', id: removed.id });
assert.deepEqual(charts.filter(item => item !== removed).map(item =>
  chart.queryChartData(editor.doc, item.id).series[0].points[1].value), [777, 777],
  '删除任一图表框架不能删除文档共享数据');
editor.undo();
api.setCategoryLevel(charts[0].id, first.categories[3].id, 1, 'Shared leaf');
assert.deepEqual(charts.map(item => chart.queryChartData(editor.doc, item.id).categories[3].levels),
  [['', 'Shared leaf'], ['', 'Shared leaf'], ['', 'Shared leaf']], '缺失叶类别转成文本后关联图表同时更新');
assert.ok(charts.every(item => chart.queryChartData(editor.doc, item.id).categories[3].label === 'Shared leaf'));
api.setCategoryLevel(charts[0].id, first.categories[0].id, 0, 'West');
assert.deepEqual(charts.map(item => chart.queryChartData(editor.doc, item.id).categories.slice(0, 2).map(category => category.levels)),
  [[['West', 'A'], [null, 'A']], [['West', 'A'], [null, 'A']], [['West', 'A'], [null, 'A']]],
  '共享父组改名保留原生跨度及重复叶标签');
api.setCategoryLevel(charts[0].id, first.categories[2].id, 0, null);
assert.ok(charts.every(item => chart.queryChartData(editor.doc, item.id).categories[2].levels[0] === null),
  '清空共享组首表达延续前组，而不是同名新组');
editor.undo();
assert.ok(charts.every(item => chart.queryChartData(editor.doc, item.id).categories[2].levels[0] === 'South'));
const bytes = await editor.save();
const identities = charts.map(item => chart.queryChartData(editor.doc, item.id)).map(data => ({
  categories: data.categories.map(category => category.id), series: data.series.map(series => series.id),
}));
const reopened = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
const savedDoc = edit.createDoc(reopened);
assert.deepEqual(chart.listEditableCharts(savedDoc).map(item => chart.queryChartData(savedDoc, item.id))
  .map(data => ({ categories: data.categories.map(category => category.id), series: data.series.map(series => series.id) })),
  identities, '同一图表部件的不同框架保存后保留各自原有身份，不受新会话前缀影响');
assert.deepEqual(chart.listEditableCharts(savedDoc).map(item =>
  chart.queryChartData(savedDoc, item.id).series[0].points[1].value), [777, 777, 777],
  '共享编辑保存重开保留全部视图');
reopened.dispose();
const recovering = await core.parse(readFileSync('fixtures/sample-chart-shared.pptx'),
  { edit: true, keepPackage: true, lazy: false });
const restored = new edit.Editor(edit.createDoc(recovering, { idPrefix: editor.doc.identity.prefix }), { recoveryFrames });
assert.deepEqual(chart.listEditableCharts(restored.doc).map(item =>
  chart.queryChartData(restored.doc, item.id).series[0].points[1].value), [777, 777, 777],
  '冷恢复重放文档覆盖与框架删除撤销');
restored.dispose(); recovering.dispose();
editor.dispose(); presentation.dispose();
await testSharedCollaboration({ core, edit, chart, collab, input: readFileSync('fixtures/sample-chart-shared.pptx'), assert });
await testSharedBoundaries({ core, edit, chart, input: readFileSync('fixtures/sample-chart-shared.pptx'), assert });
await testSharedViews({ core, edit, chart, input: readFileSync('fixtures/sample-chart-shared-views.pptx'), assert });
await testSharedMatrix({ core, edit, chart, assert });
await testSharedRows({ core, edit, chart, input: readFileSync('fixtures/sample-chart-shared-views.pptx'), assert });
await testSharedSeries({ core, edit, chart, input: readFileSync('fixtures/sample-chart-shared.pptx'), assert });
await testSharedNativeParts({ core, edit, chart, input: readFileSync('fixtures/sample-chart-shared.pptx'), assert });
await testSharedCache({ core, edit, chart, input: readFileSync('fixtures/sample-chart-shared-cache.pptx'), assert });
await testSharedCacheXY({ core, edit, chart, input: readFileSync('fixtures/sample-chart-shared-cache-xy.pptx'), assert });
await testSharedCacheNative({ core, edit, chart, input: readFileSync('fixtures/sample-chart-shared-cache.pptx'), assert });
await testSharedCacheCollaboration({ core, edit, chart, collab, input: readFileSync('fixtures/sample-chart-shared-cache.pptx'), assert });
await testSharedCacheBoundaries({ core, edit, chart, input: readFileSync('fixtures/sample-chart-shared-cache.pptx'), assert });
await testSharedSources({ core, edit, chart, input: readFileSync('fixtures/sample-chart-shared.pptx'), assert });
await testSharedRoundTrips({ core, edit, chart, assert });
await testSharedGrowth({ core, edit, chart, assert });
await testSharedGrowthCollaboration({ core, edit, chart, collab, assert });
await testSharedGrowthBoundaries({ core, edit, chart, assert });
await testSharedXYGrowth({ core, edit, chart, assert });
await testSharedCategoryGrowth({ core, edit, chart, assert });
await testSharedCategoryGrowthCollaboration({ core, edit, chart, collab, assert });
await testSharedCategoryGrowthBoundaries({ core, edit, chart, assert });
await testSharedCacheHierarchy({ core, edit, chart, assert });
await testSharedCacheHierarchyBoundaries({ core, edit, chart, assert });
await testSharedSourceXY({ core, edit, chart, assert });
await testSharedSourceXYViews({ core, edit, chart, assert });
await testSharedSourceXYCollaboration({ core, edit, chart, collab, assert });
await testSharedSourceXYBoundaries({ core, edit, chart, assert });
await testSharedSourceXYRebuild({ core, edit, chart, assert });
await testSharedTransition({ core, edit, chart, assert });
await testSharedTransitionCollaboration({ core, edit, chart, collab, assert });
await testSharedSinglePart({ core, edit, chart, assert });
record();
