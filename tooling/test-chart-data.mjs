import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { recordCount } from './lib/measured.mjs';
import { V08_OFFICE_ARTIFACTS, V08_OFFICE_MANIFEST } from './lib/v08-office-artifacts.mjs';
import { testChartDataRegressions } from './lib/test-chart-data-regressions.mjs';
import { testChartDataBoundaries } from './lib/test-chart-data-boundaries.mjs';
import { testChartDataCollaboration } from './lib/test-chart-data-collaboration.mjs';
import { testChartDataRoundTripBoundaries } from './lib/test-chart-data-roundtrip-boundaries.mjs';
import { testChartSeriesSchema } from './lib/test-chart-series-schema.mjs';
import { unzipSync, zipSync } from 'fflate';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out/chart-data');
const officeOut = join(root, 'out/v08-integration');
mkdirSync(out, { recursive: true });
mkdirSync(officeOut, { recursive: true });
const aliases = [
  ['@web-ppt/core/chart-edit', join(root, 'packages/core/src/chart-edit.ts')],
  ['@web-ppt/core/geometry/handles', join(root, 'packages/core/src/geometry/handles/index.ts')],
  ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
  ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
  ['@web-ppt/edit-core/xml', join(root, 'packages/edit-core/src/xml/index.ts')],
  ['@web-ppt/edit-core/opc', join(root, 'packages/edit-core/src/opc/index.ts')],
  ['@web-ppt/edit-core', join(root, 'packages/edit-core/src/index.ts')],
];
const [core, edit, chart, collab] = await Promise.all([
  bundleBrowser({
    root, entry: join(root, 'packages/core/src/index.ts'), output: join(out, 'core.mjs'),
  }),
  bundleBrowser({
    root, entry: join(root, 'packages/edit-core/src/index.ts'), output: join(out, 'edit.mjs'), aliases,
  }),
  bundleBrowser({
    root, entry: join(root, 'packages/edit-core/src/chart/index.ts'), output: join(out, 'chart.mjs'), aliases,
  }),
  bundleBrowser({
    root, entry: join(root, 'packages/collab/src/index.ts'), output: join(out, 'collab.mjs'), aliases,
  }),
]);
await bundleBrowser({
  root, entry: join(root, 'packages/editor/src/index.ts'), output: join(out, 'editor.mjs'),
  aliases: [...aliases, ['@web-ppt/viewer-core', join(root, 'packages/viewer-core/src/index.ts')]],
});

const failures = [];
let passed = 0;
const check = (label, condition, detail = '') => {
  if (condition) passed++;
  else failures.push(`${label}${detail ? `：${detail}` : ''}`);
};
const eq = (label, actual, expected) => check(label, Object.is(actual, expected),
  `期望 ${String(expected)}，实际 ${String(actual)}`);
const bytesEqual = (left, right) => Buffer.from(left).equals(Buffer.from(right));

class OfflineHub {
  listeners = new Map();
  queue = [];

  endpoint(id) {
    return {
      send: (message) => {
        for (const peer of this.listeners.keys()) if (peer !== id) {
          this.queue.push({ to: peer, message: structuredClone(message) });
        }
      },
      subscribe: (listener) => {
        this.listeners.set(id, listener);
        return () => this.listeners.delete(id);
      },
    };
  }

  flush(reverse = false) {
    const messages = this.queue.splice(0);
    if (reverse) messages.reverse();
    for (const item of messages) this.listeners.get(item.to)?.(structuredClone(item.message));
  }
}

const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-chart-data.pptx')));
const presentation = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
const doc = edit.createDoc(presentation, { idPrefix: 'chart-' });
const charts = chart.listEditableCharts(doc);
check('经典图表可按需发现', charts.length >= 16, String(charts.length));
eq('图表 Office 工件页数稳定', presentation.slides.length, V08_OFFICE_ARTIFACTS[0].slides);
const first = chart.queryChartData(doc, charts[0].id);
eq('真实工作簿绑定', first.binding.mode, 'workbook');
eq('类别图类型', first.kind, 'category');
eq('类别图系列数', first.series.length, 2);
eq('类别图类别数', first.categories.length, 4);
eq('稳定系列身份', first.series[0].id, `${charts[0].id}:s0`);
eq('稳定类别身份', first.categories[0].id, `${charts[0].id}:p0`);
eq('空单元格与图表缓存共享 null 真值', first.series[0].points[2].value, null);
eq('未触碰不写覆盖', Object.keys(doc.elements[charts[0].id].ovr).length, 0);
first.series[0].points[0].value = 9999;
eq('查询结果不能绕过命令修改模型', chart.queryChartData(doc, charts[0].id)
  .series[0].points[0].value, 1280);

const editor = new edit.Editor(doc, { origin: 'chart-test' });
const recoveryFrames = [];
const patchEvents = [];
editor.subscribeRecovery((frame) => recoveryFrames.push(frame));
editor.subscribePatches((event) => patchEvents.push(event));
const dataEditor = chart.createChartDataEditor(editor);
const chartChild = doc.elements[charts[0].id].children?.[0];
eq('图表内部投影不可绕过 frame 权限', doc.elements[chartChild].meta.editable, 'none');
let childEditRejected = false;
try { editor.exec({ type: 'SetXfrm', id: chartChild, x: 1 }); } catch { childEditRejected = true; }
check('普通元素命令拒绝图表内部投影', childEditRejected);
const seriesId = first.series[0].id;
const pointId = first.categories[0].id;
const projectionBefore = JSON.stringify(editor.effectiveElement(charts[0].id).children);
dataEditor.setSeriesName(charts[0].id, seriesId, '实际营收');
dataEditor.setCategoryLabel(charts[0].id, pointId, '一季度');
dataEditor.setValue(charts[0].id, seriesId, pointId, 2048);
let changed = chart.queryChartData(doc, charts[0].id);
eq('系列重命名', changed.series[0].name, '实际营收');
eq('类别重命名', changed.categories[0].label, '一季度');
eq('类别值修改', changed.series[0].points[0].value, 2048);
const projectionAfter = JSON.stringify(editor.effectiveElement(charts[0].id).children);
check('图表投影随数据重建', projectionAfter !== projectionBefore && projectionAfter.includes('实际营收'));
eq('每次编辑进入历史', editor.history.undoCount, 3);
editor.undo();
eq('撤销值修改', chart.queryChartData(doc, charts[0].id).series[0].points[0].value, 1280);
editor.redo();
eq('重做值修改', chart.queryChartData(doc, charts[0].id).series[0].points[0].value, 2048);
check('补丁按字段广播', patchEvents.every((event) => event.patches.every((patch) =>
  patch.path[3] === 'extensions' && patch.path.length > 5)));
check('恢复帧记录图表命令', recoveryFrames.filter((frame) => frame.source === 'transaction').length >= 3);

const addedCategory = dataEditor.addCategory(charts[0].id, '第五季度');
const addedSeries = dataEditor.addSeries(charts[0].id, '预算');
changed = chart.queryChartData(doc, charts[0].id);
eq('新增类别', changed.categories.at(-1).id, addedCategory);
eq('新增系列', changed.series.at(-1).id, addedSeries);
dataEditor.removeCategory(charts[0].id, addedCategory);
dataEditor.removeSeries(charts[0].id, addedSeries);
changed = chart.queryChartData(doc, charts[0].id);
eq('删除类别', changed.categories.length, 4);
eq('删除系列', changed.series.length, 2);

const savedCategory = dataEditor.addCategory(charts[0].id, '保存后第五季度');
const savedSeries = dataEditor.addSeries(charts[0].id, '保存后预算');
changed = chart.queryChartData(doc, charts[0].id);
changed.categories.forEach((category, index) => {
  dataEditor.setValue(charts[0].id, savedSeries, category.id, 3000 + index * 100);
});
dataEditor.setValue(charts[0].id, seriesId, savedCategory, 5120);
eq('保存前新增工作簿行', chart.queryChartData(doc, charts[0].id).categories.length, 5);
eq('保存前新增工作簿系列', chart.queryChartData(doc, charts[0].id).series.length, 3);

const chartByPart = (part) => charts.find((item) =>
  chart.queryChartData(doc, item.id).binding.chartPart === part)?.id;
const scatterId = chartByPart('ppt/charts/chart7.xml');
const bubbleId = chartByPart('ppt/charts/chart11.xml');
const comboId = chartByPart('ppt/charts/chart12.xml');
check('散点、气泡、组合图固件齐全', !!scatterId && !!bubbleId && !!comboId);

const scatterBefore = chart.queryChartData(doc, scatterId);
const scatterSeries = scatterBefore.series[0];
dataEditor.setPoint(scatterId, scatterSeries.id, scatterSeries.points[0].id, { x: -8, value: 8.5 });
dataEditor.removePoint(scatterId, scatterSeries.id, scatterSeries.points.at(-1).id);
const addedScatterPoint = dataEditor.addPoint(scatterId, scatterSeries.id, { x: 9.5, value: 6.4 });
const scatterAfter = chart.queryChartData(doc, scatterId);
eq('散点横坐标修改', scatterAfter.series[0].points[0].x, -8);
eq('散点纵坐标修改', scatterAfter.series[0].points[0].value, 8.5);
eq('散点增删后稳定点数', scatterAfter.series[0].points.length, scatterSeries.points.length);

const bubbleBefore = chart.queryChartData(doc, bubbleId);
const bubbleSeries = bubbleBefore.series[0];
eq('气泡图类型', bubbleSeries.plotKind, 'bubble');
dataEditor.setPoint(bubbleId, bubbleSeries.id, bubbleSeries.points[0].id,
  { x: 12, value: 24, size: 625 });
dataEditor.removePoint(bubbleId, bubbleSeries.id, bubbleSeries.points.at(-1).id);
const addedBubblePoint = dataEditor.addPoint(bubbleId, bubbleSeries.id,
  { x: 72, value: 75, size: 4096 });
const bubbleAfter = chart.queryChartData(doc, bubbleId);
eq('气泡大小修改', bubbleAfter.series[0].points[0].size, 625);
eq('气泡增删后稳定点数', bubbleAfter.series[0].points.length, bubbleSeries.points.length);

const comboBefore = chart.queryChartData(doc, comboId);
check('组合图同时保留柱线系列', comboBefore.series.some((series) => series.plotKind === 'bar')
  && comboBefore.series.some((series) => series.plotKind === 'line'));
const comboAddedSeries = dataEditor.addSeries(comboId, '组合新增折线', 'line');
chart.queryChartData(doc, comboId).categories.forEach((category, index) => {
  dataEditor.setValue(comboId, comboAddedSeries, category.id, 80 + index * 5);
});
dataEditor.removeSeries(comboId, comboBefore.series[1].id);
eq('组合图系列增删', chart.queryChartData(doc, comboId).series.length, comboBefore.series.length);

dataEditor.setSeriesName(charts[0].id, seriesId, '保存后营收');
dataEditor.setCategoryLabel(charts[0].id, pointId, '保存后一季度');
dataEditor.setValue(charts[0].id, seriesId, pointId, 4096);
const saved = await editor.saveDetailed();
writeFileSync(join(officeOut, V08_OFFICE_ARTIFACTS[0].file), saved.bytes);
const savedParts = unzipSync(saved.bytes);
const savedChartXml = new TextDecoder().decode(savedParts['ppt/charts/chart1.xml']);
check('保存同步图表缓存', savedChartXml.includes('保存后营收')
  && savedChartXml.includes('保存后一季度') && savedChartXml.includes('<c:v>4096</c:v>'));
check('保存扩展图表公式范围', savedChartXml.includes('Sheet1!$A$2:$A$6')
  && savedChartXml.includes('Sheet1!$D$1') && savedChartXml.includes('Sheet1!$D$2:$D$6'));
const workbookParts = unzipSync(savedParts['ppt/embeddings/chart-data.xlsx']);
const savedSheetXml = new TextDecoder().decode(workbookParts['xl/worksheets/sheet1.xml']);
const savedStringsXml = new TextDecoder().decode(workbookParts['xl/sharedStrings.xml']);
check('保存同步内嵌工作簿', savedSheetXml.includes('<v>4096</v>')
  && savedSheetXml.includes('r="D6"') && savedSheetXml.includes('<v>3400</v>')
  && savedStringsXml.includes('保存后营收') && savedStringsXml.includes('保存后一季度'));
check('工作簿未知结构原样保留', savedSheetXml.includes('keep-sheet-extension')
  && savedSheetXml.includes('r="Z8"')
  && new TextDecoder().decode(workbookParts['xl/worksheets/sheet2.xml']).includes('不可修改的旁路工作表'));
const savedScatterXml = new TextDecoder().decode(savedParts['ppt/charts/chart7.xml']);
const savedBubbleXml = new TextDecoder().decode(savedParts['ppt/charts/chart11.xml']);
const savedComboXml = new TextDecoder().decode(savedParts['ppt/charts/chart12.xml']);
check('保存散点缓存', savedScatterXml.includes('<c:v>-8</c:v>')
  && savedScatterXml.includes('<c:v>9.5</c:v>') && savedScatterXml.includes('<c:v>6.4</c:v>'));
check('保存气泡缓存', savedBubbleXml.includes('<c:v>625</c:v>')
  && savedBubbleXml.includes('<c:v>4096</c:v>') && savedBubbleXml.includes('<c:v>72</c:v>'));
check('保存组合图增删', savedComboXml.includes('组合新增折线')
  && !savedComboXml.includes(comboBefore.series[1].name));

const reopenedPresentation = await core.parse(saved.bytes, { edit: true, keepPackage: true, lazy: false });
const reopenedDoc = edit.createDoc(reopenedPresentation, { idPrefix: 'chart-' });
const reopened = chart.queryChartData(reopenedDoc, charts[0].id);
eq('保存重开系列', reopened.series[0].name, '保存后营收');
eq('保存重开类别', reopened.categories[0].label, '保存后一季度');
eq('保存重开数值', reopened.series[0].points[0].value, 4096);
eq('保存重开新增类别', reopened.categories.at(-1).label, '保存后第五季度');
eq('保存重开新增系列', reopened.series.at(-1).name, '保存后预算');
eq('新增类别身份跨保存稳定', reopened.categories.at(-1).id, savedCategory);
eq('新增系列身份跨保存稳定', reopened.series.at(-1).id, savedSeries);
const reopenedByPart = (part) => chart.listEditableCharts(reopenedDoc).find((item) =>
  chart.queryChartData(reopenedDoc, item.id).binding.chartPart === part)?.id;
const reopenedScatter = chart.queryChartData(reopenedDoc, reopenedByPart('ppt/charts/chart7.xml'));
const reopenedBubble = chart.queryChartData(reopenedDoc, reopenedByPart('ppt/charts/chart11.xml'));
const reopenedCombo = chart.queryChartData(reopenedDoc, reopenedByPart('ppt/charts/chart12.xml'));
check('保存重开散点新增值', reopenedScatter.series[0].points.at(-1).x === 9.5
  && reopenedScatter.series[0].points.at(-1).value === 6.4 && !!addedScatterPoint);
eq('散点新增身份跨保存稳定', reopenedScatter.series[0].points.at(-1).id, addedScatterPoint);
check('保存重开气泡新增值', reopenedBubble.series[0].points.at(-1).x === 72
  && reopenedBubble.series[0].points.at(-1).size === 4096 && !!addedBubblePoint);
eq('气泡新增身份跨保存稳定', reopenedBubble.series[0].points.at(-1).id, addedBubblePoint);
check('保存重开组合图', reopenedCombo.series.some((series) => series.name === '组合新增折线')
  && !reopenedCombo.series.some((series) => series.name === comboBefore.series[1].name));
reopenedPresentation.dispose();

const recoveryPresentation = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
const recoveryDoc = edit.createDoc(recoveryPresentation, { idPrefix: 'chart-' });
new edit.Editor(recoveryDoc, { origin: 'chart-test', recoveryFrames });
const recovered = chart.queryChartData(recoveryDoc, charts[0].id);
eq('恢复帧重放系列', recovered.series[0].name, '保存后营收');
eq('恢复帧重放数值', recovered.series[0].points[0].value, 4096);
recoveryPresentation.dispose();

const remotePresentation = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
const remoteDoc = edit.createDoc(remotePresentation, { idPrefix: 'chart-' });
const remoteEditor = new edit.Editor(remoteDoc, { origin: 'remote' });
for (const event of patchEvents) remoteEditor.applyExternalPatches(event.patches, {
  identity: event.identity, origin: event.origin, label: event.label, time: event.time,
});
const remote = chart.queryChartData(remoteDoc, charts[0].id);
eq('外部补丁收敛系列', remote.series[0].name, '保存后营收');
eq('外部补丁收敛数值', remote.series[0].points[0].value, 4096);
let maliciousRejected = false;
try {
  remoteEditor.applyExternalPatches([{
    op: 'set',
    path: ['elements', charts[0].id, 'ovr', 'extensions', 'chart-data', 'series', '__proto__', 'name'],
    value: '污染', origin: 'attacker',
  }]);
} catch { maliciousRejected = true; }
check('恶意扩展路径被拒绝', maliciousRejected && Object.prototype.name === undefined);
for (const [label, namespace] of [['危险', '__proto__'], ['空', ''], ['超长', `x${'y'.repeat(64)}`]]) {
  let rejected = false;
  try {
    remoteEditor.applyExternalPatches([{
      op: 'set',
      path: ['elements', charts[0].id, 'ovr', 'extensions', namespace, 'value'],
      value: 1, origin: 'attacker',
    }]);
  } catch { rejected = true; }
  check(`${label}扩展命名空间被拒绝`, rejected);
}
let deepExtensionRejected = false;
try {
  remoteEditor.applyExternalPatches([{
    op: 'set',
    path: ['elements', charts[0].id, 'ovr', 'extensions', 'cold-extension',
      ...Array.from({ length: 17 }, (_, index) => `level-${index}`)],
    value: 1, origin: 'attacker',
  }]);
} catch { deepExtensionRejected = true; }
check('冷态扩展路径深度受限', deepExtensionRejected);
let malformedRecordRejected = false;
try {
  remoteEditor.applyExternalPatches([{
    op: 'set',
    path: ['elements', charts[0].id, 'ovr', 'extensions', 'chart-data', 'series', 'attacker'],
    value: { id: 'attacker', order: 'a', sourceIndex: 3, plotKind: 'bar', name: '污染',
      points: {}, bindings: {}, unexpected: true },
    origin: 'attacker',
  }]);
} catch { malformedRecordRejected = true; }
check('恶意图表记录被拒绝', malformedRecordRejected);
remoteEditor.applyExternalPatches([{
  op: 'set',
  path: ['elements', charts[0].id, 'ovr', 'extensions', 'chart-data', 'series', 'deferred-attacker', 'name'],
  value: '半成品', origin: 'attacker',
}]);
check('无创建依据的标量保持 deferred 且不污染查询',
  !chart.queryChartData(remoteDoc, charts[0].id).series.some((series) => series.id === 'deferred-attacker'));
let badOrderRejected = false;
try {
  remoteEditor.applyExternalPatches([{
    op: 'set',
    path: ['elements', charts[0].id, 'ovr', 'extensions', 'chart-data', 'categories', 'bad-order', 'order'],
    value: '!', origin: 'attacker',
  }]);
} catch { badOrderRejected = true; }
check('非法分数序被拒绝', badOrderRejected);
remotePresentation.dispose();

const edgeParts = unzipSync(bytes);
const edgeChartPart = 'ppt/charts/chart1.xml';
let edgeXml = new TextDecoder().decode(edgeParts[edgeChartPart]);
edgeXml = edgeXml.replace('<c:idx val="0"/>', '<c:idx val="2147483648"/>')
  .replace('<c:idx val="1"/>', '<c:idx val="0"/>')
  .replace('Sheet1!$B$1', '[external.xlsx]Sheet1!$B$1');
edgeParts[edgeChartPart] = new TextEncoder().encode(edgeXml);
const edgePresentation = await core.parse(zipSync(edgeParts, { level: 0 }), {
  edit: true, keepPackage: true, lazy: false,
});
const edgeDoc = edit.createDoc(edgePresentation, { idPrefix: 'chart-edge-' });
const edgeChart = chart.listEditableCharts(edgeDoc)[0];
const edgeData = chart.queryChartData(edgeDoc, edgeChart.id);
eq('越界索引回退为稳定身份', edgeData.series[0].id, `${edgeChart.id}:s0`);
eq('重复索引获得无冲突身份', edgeData.series[1].id, `${edgeChart.id}:s0~1`);
eq('外部公式明确降级只读', edgeData.binding.mode, 'readonly');
let readonlyRejected = false;
try {
  chart.createChartDataEditor(new edit.Editor(edgeDoc)).setSeriesName(
    edgeChart.id, edgeData.series[0].id, '不应写入',
  );
} catch { readonlyRejected = true; }
check('只读绑定拒绝伪同步', readonlyRejected && !edgeDoc.elements[edgeChart.id].ovr.extensions);
edgePresentation.dispose();

const cacheBytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-chart.pptx')));
const cachePartsBefore = unzipSync(cacheBytes);
const cachePresentation = await core.parse(cacheBytes, { edit: true, keepPackage: true, lazy: false });
const cacheDoc = edit.createDoc(cachePresentation, { idPrefix: 'chart-cache-' });
const cacheChart = chart.listEditableCharts(cacheDoc)[0];
const cacheData = chart.queryChartData(cacheDoc, cacheChart.id);
eq('无工作簿明确降级缓存模式', cacheData.binding.mode, 'cache');
const cacheEditor = new edit.Editor(cacheDoc, { origin: 'cache-test' });
chart.createChartDataEditor(cacheEditor).setValue(
  cacheChart.id, cacheData.series[0].id, cacheData.categories[0].id, 7777,
);
const cacheSaved = await cacheEditor.saveDetailed();
const cacheSavedParts = unzipSync(cacheSaved.bytes);
check('缓存模式只更新图表 literal/cache',
  new TextDecoder().decode(cacheSavedParts['ppt/charts/chart1.xml']).includes('<c:v>7777</c:v>')
    && !Object.keys(cacheSavedParts).some((part) => part.startsWith('ppt/embeddings/')));
const cacheReopenedPresentation = await core.parse(cacheSaved.bytes, {
  edit: true, keepPackage: true, lazy: false,
});
const cacheReopenedDoc = edit.createDoc(cacheReopenedPresentation, { idPrefix: 'chart-cache-' });
eq('缓存模式保存重开', chart.queryChartData(cacheReopenedDoc, cacheChart.id)
  .series[0].points[0].value, 7777);
cacheReopenedPresentation.dispose();
cacheEditor.undo();
eq('保存后撤销立即恢复打开时真值', chart.queryChartData(cacheDoc, cacheChart.id)
  .series[0].points[0].value, cacheData.series[0].points[0].value);
check('撤销最后一次图表触碰后清除稀疏覆盖', !cacheDoc.elements[cacheChart.id].ovr.extensions);
const cacheReverted = await cacheEditor.saveDetailed();
check('保存后撤销恢复原始图表字节', bytesEqual(
  unzipSync(cacheReverted.bytes)['ppt/charts/chart1.xml'], cachePartsBefore['ppt/charts/chart1.xml'],
));
cachePresentation.dispose();

const [leftPresentation, rightPresentation] = await Promise.all([
  core.parse(bytes, { edit: true, keepPackage: true, lazy: false }),
  core.parse(bytes, { edit: true, keepPackage: true, lazy: false }),
]);
const leftDoc = edit.createDoc(leftPresentation, { idPrefix: 'chart-collab-' });
const rightDoc = edit.createDoc(rightPresentation, { idPrefix: 'chart-collab-' });
const leftEditor = new edit.Editor(leftDoc, { origin: 'left-local' });
const rightEditor = new edit.Editor(rightDoc, { origin: 'right-local' });
const hub = new OfflineHub();
const collabErrors = [];
const bindings = [
  collab.bindCollaboration(leftEditor, {
    documentId: 'chart-data', replicaId: 'a', replicaSlot: 1, provider: hub.endpoint('a'),
    onError: (error) => collabErrors.push(error),
  }),
  collab.bindCollaboration(rightEditor, {
    documentId: 'chart-data', replicaId: 'b', replicaSlot: 2, provider: hub.endpoint('b'),
    onError: (error) => collabErrors.push(error),
  }),
];
const collabChart = chart.listEditableCharts(leftDoc)[0].id;
const collabData = chart.queryChartData(leftDoc, collabChart);
const collabSeries = collabData.series[0].id;
const collabPoint = collabData.categories[0].id;
chart.createChartDataEditor(leftEditor).setSeriesName(collabChart, collabSeries, '左侧系列');
chart.createChartDataEditor(rightEditor).setValue(collabChart, collabSeries, collabPoint, 6060);
hub.flush(true);
let leftValue = chart.queryChartData(leftDoc, collabChart);
let rightValue = chart.queryChartData(rightDoc, collabChart);
check('图表不同字段并发都保留', leftValue.series[0].name === '左侧系列'
  && leftValue.series[0].points[0].value === 6060
  && JSON.stringify(leftValue) === JSON.stringify(rightValue));
chart.createChartDataEditor(leftEditor).setSeriesName(collabChart, collabSeries, '左侧竞争');
chart.createChartDataEditor(rightEditor).setSeriesName(collabChart, collabSeries, '右侧裁决');
hub.flush(true);
leftValue = chart.queryChartData(leftDoc, collabChart);
rightValue = chart.queryChartData(rightDoc, collabChart);
check('图表同字段 LWW 确定性收敛', leftValue.series[0].name === '右侧裁决'
  && JSON.stringify(leftValue) === JSON.stringify(rightValue));
const secondChart = chart.listEditableCharts(leftDoc)[1].id;
const secondData = chart.queryChartData(leftDoc, secondChart);
const secondSeries = secondData.series[0].id;
const secondPoint = secondData.categories[0].id;
chart.createChartDataEditor(leftEditor).setSeriesName(secondChart, secondSeries, '临时名称');
leftEditor.undo();
chart.createChartDataEditor(rightEditor).setValue(secondChart, secondSeries, secondPoint, 8080);
hub.flush(true);
const leftSecond = chart.queryChartData(leftDoc, secondChart);
const rightSecond = chart.queryChartData(rightDoc, secondChart);
check('首次触碰撤销与并发字段编辑仍收敛', leftSecond.series[0].name === secondData.series[0].name
  && leftSecond.series[0].points[0].value === 8080
  && JSON.stringify(leftSecond) === JSON.stringify(rightSecond));
eq('图表协同无适配错误', collabErrors.length, 0);
bindings.forEach((binding) => binding.dispose());
leftPresentation.dispose();
rightPresentation.dispose();

await testChartDataRegressions({
  core, edit, chart, collab, bytes, cacheBytes, root, out, recoveryFrames, check, eq,
});
await testChartDataBoundaries({
  core, edit, chart, collab, bytes, cacheBytes, root, out, recoveryFrames, check, eq,
});
await testChartDataCollaboration({
  core, edit, chart, collab, bytes, cacheBytes, root, out, recoveryFrames, check, eq,
});
await testChartDataRoundTripBoundaries({
  core, edit, chart, collab, bytes, cacheBytes, root, out, recoveryFrames, check, eq,
});

await testChartSeriesSchema({ core, edit, chart, bytes, cacheBytes, check });
presentation.dispose();
if (failures.length) {
  console.error(`\n图表数据失败 ${failures.length} 项：\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
writeFileSync(join(officeOut, V08_OFFICE_MANIFEST), `${JSON.stringify({
  version: 1, artifacts: V08_OFFICE_ARTIFACTS,
}, null, 2)}\n`);
recordCount('chartData', passed);
console.log(`图表数据通过 ${passed} 项断言`);
