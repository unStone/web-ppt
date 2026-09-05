import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync, zipSync } from 'fflate';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function forgeOversizedZip(bytes) {
  const result = bytes.slice();
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
  for (let offset = 0; offset + 28 < result.length; offset++) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x04034b50) view.setUint32(offset + 22, 33 * 1024 * 1024, true);
    if (signature === 0x02014b50) view.setUint32(offset + 24, 33 * 1024 * 1024, true);
  }
  return result;
}

async function fresh(core, edit, bytes, prefix) {
  const presentation = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
  return { presentation, doc: edit.createDoc(presentation, { idPrefix: prefix }) };
}

function coldRecovery(out, fixture, recoveryFrames) {
  const code = `
    const { parentPort, workerData } = require('node:worker_threads');
    const { readFileSync } = require('node:fs');
    Promise.all([import(workerData.core), import(workerData.edit)]).then(async ([core, edit]) => {
      const presentation = await core.parse(new Uint8Array(readFileSync(workerData.fixture)),
        { edit: true, keepPackage: true, lazy: false });
      const doc = edit.createDoc(presentation, { idPrefix: 'chart-' });
      const editor = new edit.Editor(doc, { recoveryFrames: workerData.frames });
      let saveRejected = false;
      try { await editor.saveDetailed(); } catch { saveRejected = true; }
      parentPort.postMessage({ restored: Object.values(doc.elements).some((record) =>
        record.ovr.extensions?.['chart-data']), saveRejected });
    }).catch((error) => parentPort.postMessage({ error: String(error?.stack ?? error) }));`;
  return new Promise((resolve, reject) => {
    const worker = new Worker(code, { eval: true, workerData: {
      core: pathToFileURL(join(out, 'core.mjs')).href,
      edit: pathToFileURL(join(out, 'edit.mjs')).href,
      fixture, frames: recoveryFrames,
    } });
    worker.once('message', (message) => message.error ? reject(new Error(message.error)) : resolve(message));
    worker.once('error', reject);
  });
}

function coldExtensionBoundary(out, fixture, recoveryFrames) {
  const code = `
    const { parentPort, workerData } = require('node:worker_threads');
    const { readFileSync } = require('node:fs');
    Promise.all([import(workerData.core), import(workerData.edit)]).then(async ([core, edit]) => {
      const bytes = new Uint8Array(readFileSync(workerData.fixture));
      const { installDomEnv } = await import(workerData.domEnv);
      const environment = installDomEnv();
      const ui = await import(workerData.editor);
      const session = await ui.openEditor(bytes, { idPrefix: 'chart-', recoveryFrames: workerData.frames });
      const restoredEditor = session.editor;
      const restoredDoc = restoredEditor.doc;
      const chartId = Object.values(restoredDoc.elements).find((record) =>
        record.ovr.extensions?.['chart-data'])?.id;
      if (!chartId) throw new Error('恢复帧没有图表补丁');
      const before = JSON.stringify(restoredEditor.effectiveElement(chartId));
      const mount = document.createElement('div');
      document.body.append(mount);
      session.mount(mount, { mode: 'edit', textMode: 'svg' });
      const beforeDomHas = mount.textContent.includes('保存后营收');
      const registrationEvents = [];
      restoredEditor.subscribe((change) => registrationEvents.push({
        source: change.source, render: [...change.renderElements], slides: [...change.dirtySlides],
      }));

      const hostilePresentation = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
      const hostileDoc = edit.createDoc(hostilePresentation, { idPrefix: 'chart-' });
      const hostileEditor = new edit.Editor(hostileDoc);
      hostileEditor.applyExternalPatches([{
        op: 'set',
        path: ['elements', chartId, 'ovr', 'extensions', 'chart-data', 'series', chartId + ':s0', 'name'],
        value: 123, origin: 'cold-attacker',
      }, {
        op: 'set',
        path: ['elements', chartId, 'ovr', 'extensions', 'chart-data', 'series', chartId + ':s0',
          'points', chartId + ':p0', 'value'],
        value: 777, origin: 'cold-valid-peer',
      }]);

      const quarantinePresentation = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
      const quarantineDoc = edit.createDoc(quarantinePresentation, { idPrefix: 'chart-' });
      const quarantineEditor = new edit.Editor(quarantineDoc);
      quarantineEditor.applyExternalPatches([{
        op: 'set',
        path: ['elements', chartId, 'ovr', 'extensions', 'chart-data', 'series', chartId + ':s0', 'name'],
        value: 123, origin: 'cold-quarantine',
      }]);
      let cyclicRejected = false;
      const cyclic = {}; cyclic.self = cyclic;
      try {
        quarantineEditor.applyExternalPatches([{
          op: 'set', path: ['elements', chartId, 'ovr', 'extensions', 'chart-data', 'cycle'],
          value: cyclic, origin: 'cold-cycle',
        }]);
      } catch { cyclicRejected = true; }
      const emptyPresentation = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
      const emptyDoc = edit.createDoc(emptyPresentation, { idPrefix: 'chart-' });
      const emptyEditor = new edit.Editor(emptyDoc);
      emptyEditor.applyExternalPatches([{
        op: 'del', path: ['elements', chartId, 'ovr', 'extensions', 'chart-data', 'nothing', 'leaf'],
        origin: 'cold-delete',
      }]);
      const deleteNoop = !emptyDoc.elements[chartId].ovr.extensions;

      const chart = await import(workerData.chart);
      const queried = chart.queryChartData(restoredDoc, chartId).series[0].name;
      const after = JSON.stringify(restoredEditor.effectiveElement(chartId));
      const afterDomHas = mount.textContent.includes('保存后营收');
      let hostileName = null;
      let hostileValue = null;
      let hostileError = null;
      try {
        const hostile = chart.queryChartData(hostileDoc, chartId).series[0];
        hostileName = hostile.name;
        hostileValue = hostile.points[0].value;
      }
      catch (error) { hostileError = String(error?.message ?? error); }
      const quarantineSaved = await quarantineEditor.save();
      const quarantineNoop = quarantineSaved.length === bytes.length
        && quarantineSaved.every((value, index) => value === bytes[index]);
      session.dispose();
      environment.dom.window.close();
      hostilePresentation.dispose();
      quarantinePresentation.dispose();
      emptyPresentation.dispose();
      parentPort.postMessage({
        beforeHas: before.includes('保存后营收'), afterHas: after.includes('保存后营收'),
        same: before === after, queried, hostileName, hostileValue, hostileError,
        cyclicRejected, deleteNoop, quarantineNoop, registrationEvents, beforeDomHas, afterDomHas,
        registrationNotified: registrationEvents.some((event) => event.render.includes(chartId)),
      });
    }).catch((error) => parentPort.postMessage({ error: String(error?.stack ?? error) }));`;
  return new Promise((resolve, reject) => {
    const worker = new Worker(code, { eval: true, workerData: {
      core: pathToFileURL(join(out, 'core.mjs')).href,
      edit: pathToFileURL(join(out, 'edit.mjs')).href,
      chart: pathToFileURL(join(out, 'chart.mjs')).href,
      editor: pathToFileURL(join(out, 'editor.mjs')).href,
      domEnv: new URL('./dom-env.mjs', import.meta.url).href,
      fixture, frames: recoveryFrames,
    } });
    worker.once('message', (message) => message.error ? reject(new Error(message.error)) : resolve(message));
    worker.once('error', reject);
  });
}

export async function testChartDataRegressions(context) {
  const { core, edit, chart, collab, bytes, cacheBytes, root, out, recoveryFrames, check, eq } = context;
  const cold = await coldRecovery(out, join(root, 'fixtures/sample-chart-data.pptx'), recoveryFrames);
  check('冷启动可先恢复按需图表补丁', cold.restored && cold.saveRejected);
  const coldBoundary = await coldExtensionBoundary(
    out, join(root, 'fixtures/sample-chart-data.pptx'), recoveryFrames,
  );
  check('按需扩展注册会使冷态投影缓存失效', !coldBoundary.beforeHas && coldBoundary.afterHas
    && !coldBoundary.same && coldBoundary.queried === '保存后营收');
  check('按需扩展注册主动通知已挂载编辑器重绘', coldBoundary.registrationEvents.length === 1
    && coldBoundary.registrationEvents[0].source === 'external'
    && coldBoundary.registrationNotified && !coldBoundary.beforeDomHas && coldBoundary.afterDomHas,
  JSON.stringify(coldBoundary.registrationEvents));
  check('冷态恶意标量加载后被隔离且不毒化查询', coldBoundary.hostileError === null
    && coldBoundary.hostileName === '2024 年');
  eq('冷态非法系列字段不吞同批合法点值', coldBoundary.hostileValue, 777);
  check('冷态循环扩展值在通用边界拒绝', coldBoundary.cyclicRejected);
  check('冷态删除不存在扩展路径是真正 no-op', coldBoundary.deleteNoop);
  check('仅含隔离字段的图表保存保持原字节', coldBoundary.quarantineNoop);

  const readonly = await fresh(core, edit, bytes, 'chart-readonly-');
  const readonlyChart = chart.listEditableCharts(readonly.doc)[0];
  readonly.doc.meta.readonly = true;
  let readonlyRejected = false;
  try {
    chart.createChartDataEditor(new edit.Editor(readonly.doc)).setSeriesName(
      readonlyChart.id, chart.queryChartData(readonly.doc, readonlyChart.id).series[0].id, '越权',
    );
  } catch { readonlyRejected = true; }
  check('图表命令遵守文档只读权限', readonlyRejected && !readonly.doc.elements[readonlyChart.id].ovr.extensions);
  readonly.presentation.dispose();

  const sharedParts = unzipSync(bytes);
  sharedParts['ppt/slides/_rels/slide2.xml.rels'] = encoder.encode(
    decoder.decode(sharedParts['ppt/slides/_rels/slide2.xml.rels'])
      .replace('../charts/chart2.xml', '../charts/chart1.xml'),
  );
  const shared = await fresh(core, edit, zipSync(sharedParts, { level: 0 }), 'chart-shared-');
  const sharedCharts = chart.listEditableCharts(shared.doc);
  eq('共享 chart part 明确只读', chart.queryChartData(shared.doc, sharedCharts[0].id).binding.mode, 'readonly');
  shared.presentation.dispose();

  const sharedBookParts = unzipSync(bytes);
  sharedBookParts['ppt/charts/_rels/chart2.xml.rels'] = encoder.encode(
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="shared" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="../embeddings/chart-data.xlsx"/></Relationships>',
  );
  const sharedBook = await fresh(core, edit, zipSync(sharedBookParts, { level: 0 }), 'chart-shared-book-');
  const sharedBookChart = chart.listEditableCharts(sharedBook.doc)[0];
  eq('共享 workbook part 明确只读', chart.queryChartData(sharedBook.doc, sharedBookChart.id).binding.mode, 'readonly');
  sharedBook.presentation.dispose();

  const cacheParts = unzipSync(cacheBytes);
  const missingXml = decoder.decode(cacheParts['ppt/charts/chart1.xml'])
    .replace(/<c:strCache>[\s\S]*?<\/c:strCache>/, '');
  cacheParts['ppt/charts/chart1.xml'] = encoder.encode(missingXml);
  const missing = await fresh(core, edit, zipSync(cacheParts, { level: 0 }), 'chart-missing-');
  const missingChart = chart.listEditableCharts(missing.doc)[0];
  const missingData = chart.queryChartData(missing.doc, missingChart.id);
  const missingEditor = new edit.Editor(missing.doc);
  chart.createChartDataEditor(missingEditor).setSeriesName(missingChart.id, missingData.series[0].id, '补建缓存');
  const missingSaved = await missingEditor.save();
  const missingSavedXml = decoder.decode(unzipSync(missingSaved)['ppt/charts/chart1.xml']);
  const missingName = missingSavedXml.indexOf('补建缓存');
  check('引用缺失缓存时在 ref 内补建 cache', missingName > 0
    && missingSavedXml.lastIndexOf('<c:strRef', missingName) > missingSavedXml.lastIndexOf('<c:tx', missingName)
    && missingSavedXml.lastIndexOf('<c:strCache', missingName) > missingSavedXml.lastIndexOf('<c:strRef', missingName)
    && missingSavedXml.indexOf('</c:strRef>', missingName) > missingName);
  missing.presentation.dispose();

  const missingNumberParts = unzipSync(cacheBytes);
  missingNumberParts['ppt/charts/chart1.xml'] = encoder.encode(
    decoder.decode(missingNumberParts['ppt/charts/chart1.xml'])
      .replace(/<c:numCache>[\s\S]*?<\/c:numCache>/, ''),
  );
  const missingNumber = await fresh(core, edit, zipSync(missingNumberParts, { level: 0 }), 'chart-num-cache-');
  const missingNumberChart = chart.listEditableCharts(missingNumber.doc)[0];
  const missingNumberData = chart.queryChartData(missingNumber.doc, missingNumberChart.id);
  const missingNumberEditor = new edit.Editor(missingNumber.doc);
  chart.createChartDataEditor(missingNumberEditor).setValue(
    missingNumberChart.id, missingNumberData.series[0].id, missingNumberData.categories[0].id, 73,
  );
  const createdNumberXml = decoder.decode(unzipSync(await missingNumberEditor.save())['ppt/charts/chart1.xml']);
  check('缺失 numCache 时按 CT_NumData 顺序补 formatCode',
    /<c:numCache><c:formatCode>General<\/c:formatCode><c:ptCount val="4"(?:\/>|><\/c:ptCount>)/.test(createdNumberXml),
    createdNumberXml.match(/<c:numCache>[\s\S]*?<\/c:numCache>/)?.[0] ?? '未生成 numCache');
  missingNumber.presentation.dispose();

  const missingCountParts = unzipSync(cacheBytes);
  missingCountParts['ppt/charts/chart1.xml'] = encoder.encode(
    decoder.decode(missingCountParts['ppt/charts/chart1.xml'])
      .replace(/(<c:numCache><c:formatCode>[\s\S]*?<\/c:formatCode>)<c:ptCount[^>]*\/>/, '$1'),
  );
  const missingCount = await fresh(core, edit, zipSync(missingCountParts, { level: 0 }), 'chart-num-count-');
  const missingCountChart = chart.listEditableCharts(missingCount.doc)[0];
  const missingCountData = chart.queryChartData(missingCount.doc, missingCountChart.id);
  const missingCountEditor = new edit.Editor(missingCount.doc);
  chart.createChartDataEditor(missingCountEditor).setValue(
    missingCountChart.id, missingCountData.series[0].id, missingCountData.categories[0].id, 74,
  );
  const countXml = decoder.decode(unzipSync(await missingCountEditor.save())['ppt/charts/chart1.xml']);
  const numberCache = countXml.match(/<c:numCache>[\s\S]*?<\/c:numCache>/)?.[0] ?? '';
  check('缺失 ptCount 时仍保持 formatCode → ptCount → pt',
    numberCache.indexOf('<c:formatCode>') < numberCache.indexOf('<c:ptCount')
      && numberCache.indexOf('<c:ptCount') < numberCache.indexOf('<c:pt '));
  missingCount.presentation.dispose();

  const prefixedParts = unzipSync(cacheBytes);
  prefixedParts['ppt/charts/chart1.xml'] = encoder.encode(
    decoder.decode(prefixedParts['ppt/charts/chart1.xml'])
      .replace('xmlns:c=', 'xmlns:cx=').replaceAll('c:', 'cx:'),
  );
  const prefixed = await fresh(core, edit, zipSync(prefixedParts, { level: 0 }), 'chart-prefix-');
  const prefixedChart = chart.listEditableCharts(prefixed.doc)[0];
  const prefixedData = chart.queryChartData(prefixed.doc, prefixedChart.id);
  const prefixedEditor = new edit.Editor(prefixed.doc);
  chart.createChartDataEditor(prefixedEditor).setValue(
    prefixedChart.id, prefixedData.series[0].id, prefixedData.categories[0].id, 9191,
  );
  const prefixedXml = decoder.decode(unzipSync(await prefixedEditor.save())['ppt/charts/chart1.xml']);
  check('替代图表前缀保持绑定', prefixedXml.includes('<cx:pt ') && !prefixedXml.includes('<c:pt '));
  prefixed.presentation.dispose();

  const templates = await fresh(core, edit, cacheBytes, 'chart-template-');
  const templateChart = chart.listEditableCharts(templates.doc)[0];
  const templateData = chart.queryChartData(templates.doc, templateChart.id);
  const templateEditor = new edit.Editor(templates.doc);
  const templateApi = chart.createChartDataEditor(templateEditor);
  templateData.series.forEach((series) => templateApi.removeSeries(templateChart.id, series.id));
  eq('删除全部来源系列后模型确实为空', chart.queryChartData(templates.doc, templateChart.id).series.length, 0);
  const replacement = templateApi.addSeries(templateChart.id, '唯一新系列');
  const templateSaved = await templateEditor.save();
  check('删除全部来源系列后仍可用预存模板保存',
    decoder.decode(unzipSync(templateSaved)['ppt/charts/chart1.xml']).includes('唯一新系列'));
  templateEditor.undo();
  check('保存后撤销仍从打开时基线投影', !!templateEditor.effectiveElement(templateChart.id).children.length
    && !chart.queryChartData(templates.doc, templateChart.id).series.some((series) => series.id === replacement));
  templateEditor.redo();
  check('撤销后重做仍恢复重建系列',
    chart.queryChartData(templates.doc, templateChart.id).series.some((series) => series.id === replacement));
  templates.presentation.dispose();

  const emptyPoints = await fresh(core, edit, bytes, 'chart-empty-points-');
  const emptyCharts = chart.listEditableCharts(emptyPoints.doc);
  const emptyEditor = new edit.Editor(emptyPoints.doc);
  const emptyApi = chart.createChartDataEditor(emptyEditor);
  for (const kind of ['scatter', 'bubble']) {
    const item = emptyCharts.find((candidate) => chart.queryChartData(emptyPoints.doc, candidate.id)
      .series.some((series) => series.plotKind === kind));
    const added = emptyApi.addSeries(item.id, `空${kind}系列`, kind);
    const visible = chart.queryChartData(emptyPoints.doc, item.id)
      .series.some((series) => series.id === added);
    check(`空点集 ${kind} 系列立即物化`, visible);
    if (visible) emptyApi.removeSeries(item.id, added);
  }
  const categoryChart = emptyCharts[0];
  const categoryData = chart.queryChartData(emptyPoints.doc, categoryChart.id);
  categoryData.categories.forEach((category) => emptyApi.removeCategory(categoryChart.id, category.id));
  const emptyCategorySeries = emptyApi.addSeries(categoryChart.id, '零类别系列');
  check('零类别的类别系列立即物化', chart.queryChartData(emptyPoints.doc, categoryChart.id)
    .series.some((series) => series.id === emptyCategorySeries));
  emptyPoints.presentation.dispose();

  const overlapParts = unzipSync(bytes);
  overlapParts['ppt/charts/chart1.xml'] = encoder.encode(
    decoder.decode(overlapParts['ppt/charts/chart1.xml'])
      .replace('Sheet1!$C$2:$C$5', 'Sheet1!$B$2:$B$5'),
  );
  const overlap = await fresh(core, edit, zipSync(overlapParts, { level: 0 }), 'chart-overlap-');
  const overlapChart = chart.listEditableCharts(overlap.doc)[0];
  eq('不同系列公式范围重叠时明确只读',
    chart.queryChartData(overlap.doc, overlapChart.id).binding.mode, 'readonly');
  overlap.presentation.dispose();

  const lastRowParts = unzipSync(bytes);
  lastRowParts['ppt/charts/chart1.xml'] = encoder.encode(
    decoder.decode(lastRowParts['ppt/charts/chart1.xml'])
      .replace('Sheet1!$B$2:$B$5', 'Sheet1!$B$1048573:$B$1048576'),
  );
  const lastRow = await fresh(core, edit, zipSync(lastRowParts, { level: 0 }), 'chart-last-row-');
  const lastRowChart = chart.listEditableCharts(lastRow.doc)[0];
  const lastRowEditor = new edit.Editor(lastRow.doc);
  eq('Excel 末行内的原始范围仍可同步', chart.queryChartData(lastRow.doc, lastRowChart.id).binding.mode, 'workbook');
  chart.createChartDataEditor(lastRowEditor).addCategory(lastRowChart.id, '越界行');
  eq('公式扩展越过 Excel 末行时原子降级只读',
    chart.queryChartData(lastRow.doc, lastRowChart.id).binding.mode, 'readonly');
  lastRow.presentation.dispose();

  const shrink = await fresh(core, edit, bytes, 'chart-shrink-');
  const shrinkChart = chart.listEditableCharts(shrink.doc)[0];
  const shrinkData = chart.queryChartData(shrink.doc, shrinkChart.id);
  const shrinkEditor = new edit.Editor(shrink.doc);
  chart.createChartDataEditor(shrinkEditor).removeCategory(shrinkChart.id, shrinkData.categories.at(-1).id);
  const shrunk = await shrinkEditor.save();
  shrink.presentation.dispose();
  const expand = await fresh(core, edit, shrunk, 'chart-shrink-');
  const expandChart = chart.listEditableCharts(expand.doc)[0];
  eq('范围缩短保存重开后仍保持 workbook', chart.queryChartData(expand.doc, expandChart.id).binding.mode, 'workbook');
  const expandEditor = new edit.Editor(expand.doc);
  chart.createChartDataEditor(expandEditor).addCategory(expandChart.id, '重新扩展');
  eq('空单元格墓碑不阻止范围重新扩展', chart.queryChartData(expand.doc, expandChart.id).binding.mode, 'workbook');
  const expandedParts = unzipSync(await expandEditor.save());
  const expandedBook = unzipSync(expandedParts['ppt/embeddings/chart-data.xlsx']);
  check('重新扩展写回原末端单元格',
    decoder.decode(expandedBook['xl/worksheets/sheet1.xml']).includes('r="A5"'));
  expand.presentation.dispose();

  const collisionParts = unzipSync(bytes);
  const workbook = unzipSync(collisionParts['ppt/embeddings/chart-data.xlsx']);
  workbook['xl/worksheets/sheet1.xml'] = encoder.encode(
    decoder.decode(workbook['xl/worksheets/sheet1.xml'])
      .replace('<row r="1">', '<row r="1"><c r="D1" t="inlineStr"><is><t>SECRET</t></is></c>'),
  );
  collisionParts['ppt/embeddings/chart-data.xlsx'] = zipSync(workbook, { level: 0 });
  const collision = await fresh(core, edit, zipSync(collisionParts, { level: 0 }), 'chart-collision-');
  const collisionChart = chart.listEditableCharts(collision.doc)[0];
  const collisionEditor = new edit.Editor(collision.doc);
  chart.createChartDataEditor(collisionEditor).addSeries(collisionChart.id, '避让系列');
  const collisionSaved = unzipSync(await collisionEditor.save());
  const collisionBook = unzipSync(collisionSaved['ppt/embeddings/chart-data.xlsx']);
  const collisionSheet = decoder.decode(collisionBook['xl/worksheets/sheet1.xml']);
  check('新增系列避让未知占用列', collisionSheet.includes('SECRET') && collisionSheet.includes('r="E1"'));
  collision.presentation.dispose();

  const rowParts = unzipSync(bytes);
  const rowBook = unzipSync(rowParts['ppt/embeddings/chart-data.xlsx']);
  rowBook['xl/worksheets/sheet1.xml'] = encoder.encode(
    decoder.decode(rowBook['xl/worksheets/sheet1.xml']).replace(
      '<row r="8"', '<row r="6"><c r="A6" t="inlineStr"><is><t>KEEP</t></is></c></row>\n<row r="8"',
    ),
  );
  rowParts['ppt/embeddings/chart-data.xlsx'] = zipSync(rowBook, { level: 0 });
  const rowCollision = await fresh(core, edit, zipSync(rowParts, { level: 0 }), 'chart-row-');
  const rowChart = chart.listEditableCharts(rowCollision.doc)[0];
  const rowEditor = new edit.Editor(rowCollision.doc);
  chart.createChartDataEditor(rowEditor).addCategory(rowChart.id, '冲突行');
  eq('类别扩展遇未知相邻行时降级只读', chart.queryChartData(rowCollision.doc, rowChart.id).binding.mode, 'readonly');
  const packageBeforeFailure = rowCollision.doc.package;
  let failedAtomically = false;
  try { await rowEditor.save(); } catch { failedAtomically = rowCollision.doc.package === packageBeforeFailure && !packageBeforeFailure.disposed; }
  check('扩展保存失败不提前提交部分包', failedAtomically);
  rowCollision.presentation.dispose();

  const oversizedParts = unzipSync(bytes);
  oversizedParts['ppt/embeddings/chart-data.xlsx'] = forgeOversizedZip(
    zipSync({ 'xl/workbook.xml': encoder.encode('<workbook/>') }),
  );
  const oversized = await fresh(core, edit, zipSync(oversizedParts, { level: 0 }), 'chart-oversized-');
  const oversizedChart = chart.listEditableCharts(oversized.doc)[0];
  eq('嵌入工作簿解压规模超限时降级只读',
    chart.queryChartData(oversized.doc, oversizedChart.id).binding.mode, 'readonly');
  oversized.presentation.dispose();

  const replicas = await Promise.all(['a', 'b', 'c'].map(async (replica) => {
    const result = await fresh(core, edit, bytes, 'chart-causal-');
    return { ...result, editor: new edit.Editor(result.doc, { origin: replica }) };
  }));
  const listeners = new Map();
  const queue = [];
  const connections = replicas.map((replica, index) => {
    const id = ['a', 'b', 'c'][index];
    return collab.bindCollaboration(replica.editor, {
      documentId: 'chart-causal', replicaId: id, replicaSlot: index + 1,
      provider: {
        send: (message) => {
          for (const peer of listeners.keys()) if (peer !== id) queue.push({ to: peer, message: structuredClone(message) });
        },
        subscribe: (listener) => { listeners.set(id, listener); return () => listeners.delete(id); },
      },
    });
  });
  const causalChart = chart.listEditableCharts(replicas[0].doc)[0].id;
  const causalApi = chart.createChartDataEditor(replicas[0].editor);
  const causalSeries = causalApi.addSeries(causalChart, '乱序系列');
  const deliver = (to, from) => {
    const index = queue.findIndex((item) => item.to === to && item.message.replicaId === from);
    if (index < 0) throw new Error(`缺少 ${from} → ${to} 协同消息`);
    const [item] = queue.splice(index, 1);
    listeners.get(to)(item.message);
  };
  deliver('b', 'a');
  const causalPoint = chart.queryChartData(replicas[1].doc, causalChart).categories[0].id;
  chart.createChartDataEditor(replicas[1].editor).setValue(causalChart, causalSeries, causalPoint, 42);
  deliver('c', 'b');
  check('后代字段先到时保持显式 deferred',
    !chart.queryChartData(replicas[2].doc, causalChart).series.some((item) => item.id === causalSeries));
  deliver('c', 'a');
  const causalResult = chart.queryChartData(replicas[2].doc, causalChart)
    .series.find((item) => item.id === causalSeries);
  eq('三副本乱序创建不覆盖后到更新', causalResult?.points[0]?.value, 42);
  connections.forEach((connection) => connection.dispose());
  replicas.forEach((replica) => replica.presentation.dispose());

}
