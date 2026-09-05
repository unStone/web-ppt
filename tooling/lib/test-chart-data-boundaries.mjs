import { performance } from 'node:perf_hooks';
import { unzipSync, zipSync } from 'fflate';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

async function fresh(core, edit, bytes, prefix) {
  const presentation = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
  return { presentation, doc: edit.createDoc(presentation, { idPrefix: prefix }) };
}

function chartIdForPart(chart, doc, part) {
  return chart.listEditableCharts(doc).find((item) =>
    chart.queryChartData(doc, item.id).binding.chartPart === part)?.id;
}

function withPart(bytes, part, mutate) {
  const parts = unzipSync(bytes);
  parts[part] = encoder.encode(mutate(decoder.decode(parts[part])));
  return zipSync(parts, { level: 0 });
}

function withWorkbook(bytes, mutate) {
  const parts = unzipSync(bytes);
  const workbook = unzipSync(parts['ppt/embeddings/chart-data.xlsx']);
  mutate(workbook);
  parts['ppt/embeddings/chart-data.xlsx'] = zipSync(workbook, { level: 0 });
  return zipSync(parts, { level: 0 });
}

function workbookParts(saved) {
  return unzipSync(unzipSync(saved)['ppt/embeddings/chart-data.xlsx']);
}

function utf16le(value) {
  const result = new Uint8Array(2 + value.length * 2);
  result[0] = 0xff;
  result[1] = 0xfe;
  const view = new DataView(result.buffer);
  for (let index = 0; index < value.length; index++) view.setUint16(2 + index * 2, value.charCodeAt(index), true);
  return result;
}

function numericCategoryXml(xml) {
  const labels = new Map([
    ['第一季度', '1'], ['第二季度', '2'], ['第三季度', '3'], ['第四季度', '4'],
  ]);
  let result = xml.replace(/<c:cat><c:strRef>([\s\S]*?)<\/c:strRef><\/c:cat>/g, (_all, body) =>
    `<c:cat><c:numRef>${body.replace('<c:strCache>',
      '<c:numCache><c:formatCode>General</c:formatCode>').replace('</c:strCache>',
      '</c:numCache>')}</c:numRef></c:cat>`);
  for (const [label, value] of labels) result = result.replaceAll(`>${label}<`, `>${value}<`);
  return result;
}

function horizontalFixture(bytes) {
  const parts = unzipSync(bytes);
  let xml = decoder.decode(parts['ppt/charts/chart1.xml']);
  const formulas = new Map([
    ['Sheet1!$B$1', 'Sheet1!$A$2'], ['Sheet1!$A$2:$A$5', 'Sheet1!$B$1:$E$1'],
    ['Sheet1!$B$2:$B$5', 'Sheet1!$B$2:$E$2'], ['Sheet1!$C$1', 'Sheet1!$A$3'],
    ['Sheet1!$C$2:$C$5', 'Sheet1!$B$3:$E$3'],
  ]);
  let index = 0;
  for (const [before] of formulas) xml = xml.replaceAll(before, `__FORMULA_${index++}__`);
  index = 0;
  for (const [, after] of formulas) xml = xml.replaceAll(`__FORMULA_${index++}__`, after);
  parts['ppt/charts/chart1.xml'] = encoder.encode(xml);
  const workbook = unzipSync(parts['ppt/embeddings/chart-data.xlsx']);
  let sheet = decoder.decode(workbook['xl/worksheets/sheet1.xml'])
    .replace(/<dimension ref="[^"]+"\/>/, '<dimension ref="A1:E3"/>');
  const data = `<sheetData>
<row r="1"><c r="B1" t="inlineStr"><is><t>第一季度</t></is></c><c r="C1" t="inlineStr"><is><t>第二季度</t></is></c><c r="D1" t="inlineStr"><is><t>第三季度</t></is></c><c r="E1" t="inlineStr"><is><t>第四季度</t></is></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>2024 年</t></is></c><c r="B2"><v>1280</v></c><c r="C2"><v>1640</v></c><c r="D2"/><c r="E2"><v>2050</v></c></row>
<row r="3"><c r="A3" t="inlineStr"><is><t>2025 年</t></is></c><c r="B3"><v>1510</v></c><c r="C3"><v>1390</v></c><c r="D3"><v>1880</v></c><c r="E3"><v>2360</v></c></row>
</sheetData>`;
  sheet = sheet.replace(/<sheetData>[\s\S]*?<\/sheetData>/, data);
  workbook['xl/worksheets/sheet1.xml'] = encoder.encode(sheet);
  parts['ppt/embeddings/chart-data.xlsx'] = zipSync(workbook, { level: 0 });
  return zipSync(parts, { level: 0 });
}

function strictFixture(bytes) {
  const parts = unzipSync(bytes);
  const replacements = new Map([
    ['http://schemas.openxmlformats.org/drawingml/2006/chart',
      'http://purl.oclc.org/ooxml/drawingml/chart'],
    ['http://schemas.openxmlformats.org/drawingml/2006/main',
      'http://purl.oclc.org/ooxml/drawingml/main'],
    ['http://schemas.openxmlformats.org/presentationml/2006/main',
      'http://purl.oclc.org/ooxml/presentationml/main'],
    ['http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      'http://purl.oclc.org/ooxml/officeDocument/relationships'],
    ['http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'http://purl.oclc.org/ooxml/spreadsheetml/main'],
  ]);
  const targets = ['ppt/slides/slide1.xml', 'ppt/charts/chart1.xml'];
  const workbook = unzipSync(parts['ppt/embeddings/chart-data.xlsx']);
  for (const part of Object.keys(workbook).filter((name) => name.endsWith('.xml'))) {
    let xml = decoder.decode(workbook[part]);
    for (const [before, after] of replacements) xml = xml.replaceAll(before, after);
    workbook[part] = encoder.encode(xml);
  }
  parts['ppt/embeddings/chart-data.xlsx'] = zipSync(workbook, { level: 0 });
  for (const part of targets) {
    let xml = decoder.decode(parts[part]);
    for (const [before, after] of replacements) xml = xml.replaceAll(before, after);
    parts[part] = encoder.encode(xml);
  }
  return zipSync(parts, { level: 0 });
}

async function testApiAndColdBoundaries({ core, edit, chart, bytes, check, eq }) {
  const opened = await fresh(core, edit, bytes, 'chart-boundary-');
  const categoryId = chartIdForPart(chart, opened.doc, 'ppt/charts/chart1.xml');
  const scatterId = chartIdForPart(chart, opened.doc, 'ppt/charts/chart7.xml');
  const editor = new edit.Editor(opened.doc);
  const api = chart.createChartDataEditor(editor);
  const category = chart.queryChartData(opened.doc, categoryId);
  const scatter = chart.queryChartData(opened.doc, scatterId);
  let categoryPointRejected = false;
  try { api.removePoint(categoryId, category.series[0].id, category.categories[0].id); }
  catch { categoryPointRejected = true; }
  check('类别图拒绝独立删除数据点', categoryPointRejected);
  for (const [label, action] of [
    ['新增', () => api.addCategory(scatterId, '非法类别')],
    ['改名', () => api.setCategoryLabel(scatterId, 'missing', '非法类别')],
    ['删除', () => api.removeCategory(scatterId, 'missing')],
  ]) {
    let rejected = false;
    try { action(); } catch { rejected = true; }
    check(`纯 XY 图拒绝${label}类别`, rejected);
  }
  const record = opened.doc.elements[categoryId];
  record.ovr.extensions = { 'chart-data': {
    kind: 'xy', binding: 'hostile', categories: 7, series: 8, unknown: true,
  } };
  const restored = chart.queryChartData(opened.doc, categoryId);
  check('冷态根字段注入按来源逐字段恢复', restored.kind === 'category'
    && restored.series.length === category.series.length && restored.categories.length === category.categories.length);
  const unchanged = await editor.save();
  check('仅含无效根字段的保存保持原字节', Buffer.from(unchanged).equals(Buffer.from(bytes)));
  let rootRejected = false;
  try { editor.applyExternalPatches([{
    op: 'set', path: ['elements', categoryId, 'ovr', 'extensions', 'chart-data'],
    value: 1, origin: 'hostile',
  }]); } catch { rootRejected = true; }
  check('扩展根替换被拒绝', rootRejected);
  let cyclicRejected = false;
  const cyclic = { id: 'cyclic' }; cyclic.points = cyclic;
  try { editor.exec({ type: 'Extension', namespace: 'chart-data', id: categoryId,
    payload: { op: 'add-series', series: cyclic } }); } catch { cyclicRejected = true; }
  check('循环新增系列在叶展开前被拒绝', cyclicRejected);
  opened.presentation.dispose();

  const unsupported = await fresh(core, edit, bytes, 'chart-unsupported-');
  const unsupportedId = chartIdForPart(chart, unsupported.doc, 'ppt/charts/chart1.xml');
  const unsupportedRecord = unsupported.doc.elements[unsupportedId];
  unsupportedRecord.ovr.extensions = { 'chart-data': { series: { hostile: {
    id: 'hostile', order: edit.initialFractionalIndex(50), sourceIndex: 50,
    plotKind: 'line', name: '无来源图种', points: {},
    bindings: { name: { formula: null, cache: 'literal' },
      categories: { formula: null, cache: 'literal' }, values: { formula: null, cache: 'literal' } },
  } } } };
  check('冷态新增系列不能伪造来源不存在的绘图区',
    !chart.queryChartData(unsupported.doc, unsupportedId).series.some((item) => item.id === 'hostile'));
  let projectionSafe = true;
  try { new edit.Editor(unsupported.doc).effectiveElement(unsupportedId); } catch { projectionSafe = false; }
  check('不支持图种不会击穿投影', projectionSafe);
  unsupported.presentation.dispose();

  const duplicated = await fresh(core, edit, bytes, 'chart-duplicate-');
  const sourceSlide = duplicated.doc.slideOrder[0];
  const duplicateEditor = new edit.Editor(duplicated.doc);
  duplicateEditor.exec({ type: 'DuplicateSlide', id: sourceSlide });
  const sharedCharts = chart.listEditableCharts(duplicated.doc).filter((item) =>
    chart.queryChartData(duplicated.doc, item.id).binding.chartPart === 'ppt/charts/chart1.xml');
  check('未保存的页面副本立即识别共享 chart part', sharedCharts.length === 2
    && sharedCharts.every((item) => chart.queryChartData(duplicated.doc, item.id).binding.mode === 'readonly'));
  const duplicatedSaved = await duplicateEditor.save();
  const sharedAfterSave = chart.listEditableCharts(duplicated.doc).filter((item) =>
    chart.queryChartData(duplicated.doc, item.id).binding.chartPart === 'ppt/charts/chart1.xml');
  check('包替换后共享图表定位缓存重新求值', sharedAfterSave.length === 2
    && sharedAfterSave.every((item) => chart.queryChartData(duplicated.doc, item.id).binding.mode === 'readonly'));
  duplicated.presentation.dispose();
  const duplicatedReopen = await fresh(core, edit, duplicatedSaved, 'chart-duplicate-reopen-');
  const reopenedShared = chart.listEditableCharts(duplicatedReopen.doc).filter((item) =>
    chart.queryChartData(duplicatedReopen.doc, item.id).binding.chartPart === 'ppt/charts/chart1.xml');
  check('页面副本保存重开后仍明确共享只读', reopenedShared.length === 2
    && reopenedShared.every((item) => chart.queryChartData(duplicatedReopen.doc, item.id).binding.mode === 'readonly'));
  duplicatedReopen.presentation.dispose();
}

async function testCachesAndPointIdentity({ core, edit, chart, bytes, cacheBytes, check, eq }) {
  const missingCache = withPart(bytes, 'ppt/charts/chart1.xml', (xml) =>
    xml.replace(/<c:numCache>[\s\S]*?<\/c:numCache>/, ''));
  const missing = await fresh(core, edit, missingCache, 'chart-missing-workbook-cache-');
  const missingId = chartIdForPart(chart, missing.doc, 'ppt/charts/chart1.xml');
  eq('工作簿图表缺缓存时拒绝把未知值当 null',
    chart.queryChartData(missing.doc, missingId).binding.mode, 'readonly');
  missing.presentation.dispose();

  const utf16Parts = unzipSync(cacheBytes);
  utf16Parts['ppt/charts/chart1.xml'] = utf16le(
    decoder.decode(utf16Parts['ppt/charts/chart1.xml']).replace('encoding="UTF-8"', 'encoding="UTF-16"'),
  );
  const utf16 = await fresh(core, edit, zipSync(utf16Parts, { level: 0 }), 'chart-utf16-');
  const utf16Id = chart.listEditableCharts(utf16.doc)[0].id;
  const utf16Data = chart.queryChartData(utf16.doc, utf16Id);
  const utf16Editor = new edit.Editor(utf16.doc);
  chart.createChartDataEditor(utf16Editor).setValue(
    utf16Id, utf16Data.series[0].id, utf16Data.categories[0].id, 6161,
  );
  const utf16Saved = unzipSync(await utf16Editor.save())['ppt/charts/chart1.xml'];
  check('UTF-16 图表 XML 可查询并保持编码写回', utf16Data.series.length === 2
    && utf16Saved[0] === 0xff && utf16Saved[1] === 0xfe
    && new TextDecoder('utf-16le').decode(utf16Saved).includes('<c:v>6161</c:v>'));
  utf16.presentation.dispose();

  const trailing = withPart(bytes, 'ppt/charts/chart7.xml', (xml) =>
    xml.replaceAll('<c:ptCount val="7"/>', '<c:ptCount val="8"/>'));
  const trailingOpen = await fresh(core, edit, trailing, 'chart-trailing-');
  const trailingId = chartIdForPart(chart, trailingOpen.doc, 'ppt/charts/chart7.xml');
  const trailingData = chart.queryChartData(trailingOpen.doc, trailingId);
  eq('散点尾部空值按 ptCount 保留', trailingData.series[0].points.length, 8);
  eq('散点尾部空值物化为 null', trailingData.series[0].points[7].value, null);
  trailingOpen.presentation.dispose();

  const oversized = withPart(bytes, 'ppt/charts/chart7.xml', (xml) =>
    xml.replace('<c:ptCount val="7"/>', '<c:ptCount val="1000000000"/>'));
  const oversizedOpen = await fresh(core, edit, oversized, 'chart-oversized-count-');
  const oversizedId = chartIdForPart(chart, oversizedOpen.doc, 'ppt/charts/chart7.xml');
  eq('恶意 ptCount 有界降级只读',
    chart.queryChartData(oversizedOpen.doc, oversizedId).binding.mode, 'readonly');
  oversizedOpen.presentation.dispose();

  const styled = withPart(cacheBytes, 'ppt/charts/chart1.xml', (xml) => xml.replace('<c:cat>',
    '<c:dPt><c:idx val="2"/><c:spPr><a:solidFill><a:srgbClr val="123456"/></a:solidFill></c:spPr></c:dPt><c:dLbls><c:dLbl><c:idx val="2"/><c:showVal val="1"/></c:dLbl></c:dLbls><c:cat>'));
  const shifted = await fresh(core, edit, styled, 'chart-point-style-');
  const shiftedId = chart.listEditableCharts(shifted.doc)[0].id;
  const shiftedData = chart.queryChartData(shifted.doc, shiftedId);
  const shiftedEditor = new edit.Editor(shifted.doc);
  chart.createChartDataEditor(shiftedEditor).removeCategory(shiftedId, shiftedData.categories[1].id);
  const shiftedXml = decoder.decode(unzipSync(await shiftedEditor.save())['ppt/charts/chart1.xml']);
  check('删除前序类别后单点格式随稳定身份重映射',
    /<c:dPt><c:idx val="1"\/>/.test(shiftedXml)
      && /<c:dLbl><c:idx val="1"\/>/.test(shiftedXml));
  shifted.presentation.dispose();
  const removed = await fresh(core, edit, styled, 'chart-point-style-remove-');
  const removedId = chart.listEditableCharts(removed.doc)[0].id;
  const removedData = chart.queryChartData(removed.doc, removedId);
  const removedEditor = new edit.Editor(removed.doc);
  chart.createChartDataEditor(removedEditor).removeCategory(removedId, removedData.categories[2].id);
  const removedXml = decoder.decode(unzipSync(await removedEditor.save())['ppt/charts/chart1.xml']);
  check('删除目标类别时移除悬空单点格式',
    !removedXml.includes('<c:dPt>') && !removedXml.includes('<c:dLbl>'));
  removed.presentation.dispose();

  const cacheOpen = await fresh(core, edit, cacheBytes, 'chart-cache-literal-');
  const cacheId = chart.listEditableCharts(cacheOpen.doc)[0].id;
  const cacheEditor = new edit.Editor(cacheOpen.doc);
  chart.createChartDataEditor(cacheEditor).addSeries(cacheId, '缓存新增系列');
  const cacheXml = decoder.decode(unzipSync(await cacheEditor.save())['ppt/charts/chart1.xml']);
  const addedSeriesXml = [...cacheXml.matchAll(/<c:ser(?:\s[^>]*)?>[\s\S]*?<\/c:ser>/g)]
    .find((match) => match[0].includes('缓存新增系列'))?.[0] ?? '';
  check('缓存模式新系列使用合法 literal 容器', addedSeriesXml.includes('<c:strLit>')
    && addedSeriesXml.includes('<c:numLit>') && !addedSeriesXml.includes('<c:strRef>')
    && !addedSeriesXml.includes('<c:numRef>'));
  cacheOpen.presentation.dispose();
}

async function testWorkbookFidelity({ core, edit, chart, bytes, check }) {
  const strict = await fresh(core, edit, strictFixture(bytes), 'chart-strict-');
  const strictId = chartIdForPart(chart, strict.doc, 'ppt/charts/chart1.xml');
  const strictData = chart.queryChartData(strict.doc, strictId);
  const strictEditor = new edit.Editor(strict.doc);
  chart.createChartDataEditor(strictEditor).setValue(
    strictId, strictData.series[0].id, strictData.categories[0].id, 7070,
  );
  const strictSaved = await strictEditor.save();
  const strictChartXml = decoder.decode(unzipSync(strictSaved)['ppt/charts/chart1.xml']);
  const strictSheetXml = decoder.decode(workbookParts(strictSaved)['xl/worksheets/sheet1.xml']);
  check('Strict OOXML 图表与工作簿可发现并原命名空间写回',
    strictChartXml.includes('http://purl.oclc.org/ooxml/drawingml/chart')
      && strictChartXml.includes('<c:v>7070</c:v>')
      && strictSheetXml.includes('http://purl.oclc.org/ooxml/spreadsheetml/main')
      && strictSheetXml.includes('<v>7070</v>'));
  strict.presentation.dispose();

  const numericBytes = withPart(bytes, 'ppt/charts/chart1.xml', numericCategoryXml);
  const numeric = await fresh(core, edit, numericBytes, 'chart-numeric-cat-');
  const numericId = chartIdForPart(chart, numeric.doc, 'ppt/charts/chart1.xml');
  const numericData = chart.queryChartData(numeric.doc, numericId);
  const numericEditor = new edit.Editor(numeric.doc);
  chart.createChartDataEditor(numericEditor).setValue(
    numericId, numericData.series[0].id, numericData.categories[0].id, 9090,
  );
  const numericSaved = await numericEditor.save();
  const numericXml = decoder.decode(unzipSync(numericSaved)['ppt/charts/chart1.xml']);
  const numericSheet = decoder.decode(workbookParts(numericSaved)['xl/worksheets/sheet1.xml']);
  check('未改数值类别时保留 numRef 与数值单元格', numericXml.includes('<c:cat><c:numRef>')
    && /<c r="A2"><v>1<\/v><\/c>/.test(numericSheet));
  numeric.presentation.dispose();
  const textual = await fresh(core, edit, numericBytes, 'chart-text-cat-');
  const textualId = chartIdForPart(chart, textual.doc, 'ppt/charts/chart1.xml');
  const textualData = chart.queryChartData(textual.doc, textualId);
  const textualEditor = new edit.Editor(textual.doc);
  chart.createChartDataEditor(textualEditor).setCategoryLabel(
    textualId, textualData.categories[0].id, '非数值类别',
  );
  const textualXml = decoder.decode(unzipSync(await textualEditor.save())['ppt/charts/chart1.xml']);
  check('数值类别引入文本后切换为 strRef', textualXml.includes('<c:cat><c:strRef>')
    && !textualXml.includes('<c:cat><c:numRef>'));
  textual.presentation.dispose();

  const spaced = await fresh(core, edit, bytes, 'chart-space-');
  const spacedId = chartIdForPart(chart, spaced.doc, 'ppt/charts/chart1.xml');
  const spacedData = chart.queryChartData(spaced.doc, spacedId);
  const spacedEditor = new edit.Editor(spaced.doc);
  const spacedApi = chart.createChartDataEditor(spacedEditor);
  spacedApi.setSeriesName(spacedId, spacedData.series[0].id, ' 前后空格 ');
  spacedApi.setCategoryLabel(spacedId, spacedData.categories[0].id, ' 类别空格 ');
  const spacedSaved = await spacedEditor.save();
  const strings = decoder.decode(workbookParts(spacedSaved)['xl/sharedStrings.xml']);
  check('工作簿字符串用 xml:space 保留首尾空格',
    strings.includes('<t xml:space="preserve"> 前后空格 </t>')
      && strings.includes('<t xml:space="preserve"> 类别空格 </t>'));
  check('工作簿写入移除无法诚实维护的 SST 计数',
    !/<sst[^>]+(?:count|uniqueCount)=/.test(strings));
  spaced.presentation.dispose();

  const unsafeFormula = withWorkbook(bytes, (workbook) => {
    workbook['xl/worksheets/sheet1.xml'] = encoder.encode(
      decoder.decode(workbook['xl/worksheets/sheet1.xml'])
        .replace('<c r="B2" s="1"><v>', '<c r="B2" s="1"><f>1+1</f><v>'));
  });
  const unsafe = await fresh(core, edit, unsafeFormula, 'chart-formula-cell-');
  const unsafeId = chartIdForPart(chart, unsafe.doc, 'ppt/charts/chart1.xml');
  check('公式单元格不被图表缓存写回覆盖',
    chart.queryChartData(unsafe.doc, unsafeId).binding.mode === 'readonly');
  unsafe.presentation.dispose();

  const vendorCell = withWorkbook(bytes, (workbook) => {
    workbook['xl/worksheets/sheet1.xml'] = encoder.encode(
      decoder.decode(workbook['xl/worksheets/sheet1.xml']).replace(
        '<c r="B2" s="1"><v>',
        '<c r="B2" s="1"><vendor:v xmlns:vendor="urn:vendor">SECRET</vendor:v><v>',
      ));
  });
  const vendor = await fresh(core, edit, vendorCell, 'chart-vendor-cell-');
  const vendorId = chartIdForPart(chart, vendor.doc, 'ppt/charts/chart1.xml');
  check('工作簿异命名空间同名节点视为未知占用',
    chart.queryChartData(vendor.doc, vendorId).binding.mode === 'readonly');
  vendor.presentation.dispose();

  const prefixedWorkbook = withWorkbook(bytes, (workbook) => {
    const names = 'worksheet|dimension|sheetViews|sheetView|sheetFormatPr|sheetData|row|c|v|is|t|extLst|ext';
    const xml = decoder.decode(workbook['xl/worksheets/sheet1.xml'])
      .replace('<worksheet xmlns=', '<s:worksheet xmlns:s=')
      .replace(new RegExp(`<(/?)(${names})(?=[\\s>/])`, 'g'), '<$1s:$2');
    workbook['xl/worksheets/sheet1.xml'] = encoder.encode(xml);
  });
  const prefixed = await fresh(core, edit, prefixedWorkbook, 'chart-sheet-prefix-');
  const prefixedId = chartIdForPart(chart, prefixed.doc, 'ppt/charts/chart1.xml');
  const prefixedData = chart.queryChartData(prefixed.doc, prefixedId);
  const prefixedEditor = new edit.Editor(prefixed.doc);
  chart.createChartDataEditor(prefixedEditor).setValue(
    prefixedId, prefixedData.series[0].id, prefixedData.categories[0].id, 4242,
  );
  const prefixedSheet = decoder.decode(workbookParts(await prefixedEditor.save())['xl/worksheets/sheet1.xml']);
  check('工作簿合法替代前缀仍能安全写回', prefixedSheet.includes('<s:v>4242</s:v>'));
  prefixed.presentation.dispose();

  const mergedBytes = withWorkbook(bytes, (workbook) => {
    workbook['xl/worksheets/sheet1.xml'] = encoder.encode(
      decoder.decode(workbook['xl/worksheets/sheet1.xml']).replace('<extLst>',
        '<mergeCells count="1"><mergeCell ref="D1:E5"/></mergeCells><extLst>'));
  });
  const merged = await fresh(core, edit, mergedBytes, 'chart-merged-');
  const mergedId = chartIdForPart(chart, merged.doc, 'ppt/charts/chart1.xml');
  const mergedEditor = new edit.Editor(merged.doc);
  chart.createChartDataEditor(mergedEditor).addSeries(mergedId, '跨过合并区');
  const mergedSheet = decoder.decode(workbookParts(await mergedEditor.save())['xl/worksheets/sheet1.xml']);
  check('新增系列整体避让合并单元格范围', mergedSheet.includes('r="F1"'));
  merged.presentation.dispose();

  const dimensionBytes = withWorkbook(bytes, (workbook) => {
    workbook['xl/worksheets/sheet1.xml'] = encoder.encode(
      decoder.decode(workbook['xl/worksheets/sheet1.xml'])
        .replace('<dimension ref="A1:Z8"/>', '<dimension ref="A1:C5"/>')
        .replace(/\n?<row r="8"[\s\S]*?<\/row>/, ''));
  });
  const dimension = await fresh(core, edit, dimensionBytes, 'chart-dimension-');
  const dimensionId = chartIdForPart(chart, dimension.doc, 'ppt/charts/chart1.xml');
  const dimensionEditor = new edit.Editor(dimension.doc);
  chart.createChartDataEditor(dimensionEditor).addSeries(dimensionId, '扩维系列');
  const dimensionSheet = decoder.decode(workbookParts(await dimensionEditor.save())['xl/worksheets/sheet1.xml']);
  check('新增单元格同步扩展 worksheet dimension', dimensionSheet.includes('<dimension ref="A1:D5"/>'));
  dimension.presentation.dispose();

  const horizontal = await fresh(core, edit, horizontalFixture(bytes), 'chart-horizontal-');
  const horizontalId = chartIdForPart(chart, horizontal.doc, 'ppt/charts/chart1.xml');
  const horizontalEditor = new edit.Editor(horizontal.doc);
  chart.createChartDataEditor(horizontalEditor).addSeries(horizontalId, '横向新增');
  const horizontalXml = decoder.decode(unzipSync(await horizontalEditor.save())['ppt/charts/chart1.xml']);
  check('横向一维数据为名称和值分配同一新行', horizontalXml.includes('Sheet1!$A$4')
    && horizontalXml.includes('Sheet1!$B$4:$E$4'));
  horizontal.presentation.dispose();

  const spoofedChart = withPart(bytes, 'ppt/charts/chart1.xml', (xml) => xml.replace(
    '<c:val><c:numRef>',
    '<c:val><vendor:numRef xmlns:vendor="urn:vendor"><vendor:f>SECRET</vendor:f><vendor:numCache><vendor:ptCount val="1"/><vendor:pt idx="0"><vendor:v>999</vendor:v></vendor:pt></vendor:numCache></vendor:numRef><c:numRef>',
  ));
  const spoofed = await fresh(core, edit, spoofedChart, 'chart-namespace-spoof-');
  const spoofedId = chartIdForPart(chart, spoofed.doc, 'ppt/charts/chart1.xml');
  const spoofedData = chart.queryChartData(spoofed.doc, spoofedId);
  const spoofedEditor = new edit.Editor(spoofed.doc);
  chart.createChartDataEditor(spoofedEditor).setValue(
    spoofedId, spoofedData.series[0].id, spoofedData.categories[0].id, 4343,
  );
  const spoofedSaved = decoder.decode(unzipSync(await spoofedEditor.save())['ppt/charts/chart1.xml']);
  check('图表异命名空间同名节点不能劫持读写', spoofedData.series[0].points[0].value === 1280
    && spoofedSaved.includes('<vendor:f>SECRET</vendor:f>') && spoofedSaved.includes('<c:v>4343</c:v>'));
  spoofed.presentation.dispose();
}

async function testBatchAndCombo({ core, edit, chart, bytes, check, eq }) {
  const large = await fresh(core, edit, bytes, 'chart-large-batch-');
  const scatterId = chartIdForPart(chart, large.doc, 'ppt/charts/chart7.xml');
  const editor = new edit.Editor(large.doc);
  const points = Object.create(null);
  for (let index = 0; index < 1_000; index++) {
    const id = `large-point-${index}`;
    points[id] = { id, order: edit.initialFractionalIndex(index), value: index, x: index };
  }
  const series = {
    id: 'large-series', order: edit.initialFractionalIndex(100), sourceIndex: 100,
    plotKind: 'scatter', name: '大批次系列', points,
    bindings: { name: { formula: null, cache: 'literal' },
      x: { formula: null, cache: 'literal' }, y: { formula: null, cache: 'literal' } },
  };
  const started = performance.now();
  editor.exec({ type: 'Extension', namespace: 'chart-data', id: scatterId,
    payload: { op: 'add-series', series } });
  const elapsed = performance.now() - started;
  check('千点系列补丁批次只解析一次来源', elapsed < 2_000, `${elapsed.toFixed(1)}ms`);
  eq('千点系列完整物化', chart.queryChartData(large.doc, scatterId)
    .series.find((item) => item.id === series.id)?.points.length, 1_000);
  large.presentation.dispose();

  const combo = await fresh(core, edit, bytes, 'chart-combo-id-');
  const comboId = chartIdForPart(chart, combo.doc, 'ppt/charts/chart12.xml');
  const comboBefore = chart.queryChartData(combo.doc, comboId);
  const originalLine = comboBefore.series.find((item) => item.plotKind === 'line');
  const comboEditor = new edit.Editor(combo.doc);
  const addedBar = chart.createChartDataEditor(comboEditor).addSeries(comboId, '新增柱形', 'bar');
  const semanticOrder = chart.queryChartData(combo.doc, comboId).series.map((item) => item.id);
  const comboSaved = await comboEditor.save();
  combo.presentation.dispose();
  const reopened = await fresh(core, edit, comboSaved, 'chart-combo-id-');
  const reopenedData = chart.queryChartData(reopened.doc, comboId);
  check('组合图清单按 XML 物理系列顺序保持身份',
    reopenedData.series.some((item) => item.id === originalLine.id && item.plotKind === 'line')
      && reopenedData.series.some((item) => item.id === addedBar && item.name === '新增柱形'
        && item.plotKind === 'bar'));
  check('组合图保存重开保持 c:order 语义顺序',
    JSON.stringify(reopenedData.series.map((item) => item.id)) === JSON.stringify(semanticOrder));
  reopened.presentation.dispose();
}

export async function testChartDataBoundaries(context) {
  await testApiAndColdBoundaries(context);
  await testCachesAndPointIdentity(context);
  await testWorkbookFidelity(context);
  await testBatchAndCombo(context);
}
