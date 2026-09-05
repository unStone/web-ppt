import { unzipSync, zipSync } from 'fflate';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { V08_OFFICE_ARTIFACTS } from './v08-office-artifacts.mjs';

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const STRICT_CHART = 'http://purl.oclc.org/ooxml/drawingml/chart';
const STRICT_SHEET = 'http://purl.oclc.org/ooxml/spreadsheetml/main';
const IDENTITY_URI = 'urn:web-ppt:chart-data-identities:v1';

async function fresh(core, edit, bytes, prefix) {
  const presentation = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
  return { presentation, doc: edit.createDoc(presentation, { idPrefix: prefix }) };
}

function replaceOccurrence(source, search, occurrence, replacement) {
  let offset = 0;
  for (let index = 1; index <= occurrence; index++) {
    offset = source.indexOf(search, offset);
    if (offset < 0) throw new Error(`找不到第 ${occurrence} 个 ${search}`);
    if (index === occurrence) return source.slice(0, offset) + replacement + source.slice(offset + search.length);
    offset += search.length;
  }
  return source;
}

function mutatePart(bytes, part, mutate) {
  const parts = unzipSync(bytes);
  parts[part] = encoder.encode(mutate(decoder.decode(parts[part])));
  return zipSync(parts, { level: 0 });
}

function mutateWorkbook(bytes, mutate) {
  const parts = unzipSync(bytes);
  const workbook = unzipSync(parts['ppt/embeddings/chart-data.xlsx']);
  mutate(workbook);
  parts['ppt/embeddings/chart-data.xlsx'] = zipSync(workbook, { level: 0 });
  return zipSync(parts, { level: 0 });
}

function numericCategoryChart(source) {
  const labels = new Map([
    ['第一季度', '1'], ['第二季度', '2'], ['第三季度', '3'], ['第四季度', '4'],
  ]);
  let xml = source.replace(/<c:cat><c:strRef>([\s\S]*?)<\/c:strRef><\/c:cat>/g, (_all, body) =>
    `<c:cat><c:numRef>${body.replace('<c:strCache>',
      '<c:numCache><c:formatCode>General</c:formatCode>').replace('</c:strCache>',
      '</c:numCache>')}</c:numRef></c:cat>`);
  for (const [label, value] of labels) xml = xml.replaceAll(`>${label}<`, `>${value}<`);
  return xml;
}

async function testEmptyRoundTrip({ core, edit, chart, bytes, root, check, eq }) {
  const source = await fresh(core, edit, bytes, 'chart-empty-reopen-');
  const sourceId = chart.listEditableCharts(source.doc)[0].id;
  const editor = new edit.Editor(source.doc);
  const sourceApi = chart.createChartDataEditor(editor);
  chart.queryChartData(source.doc, sourceId).series.forEach((series) => sourceApi.removeSeries(sourceId, series.id));
  const saved = await editor.save();
  const emptyXml = decoder.decode(unzipSync(saved)['ppt/charts/chart1.xml']);
  const barPlot = emptyXml.match(/<c:barChart>[\s\S]*?<\/c:barChart>/)?.[0] ?? '';
  const template = emptyXml.match(/<wppt:template[\s\S]*?<\/wppt:template>/)?.[0] ?? '';
  const singletons = ['idx', 'order', 'tx', 'cat', 'val'];
  check('空图保存持久化不可见系列模板', !barPlot.includes('<c:ser>')
    && singletons.every((name) => (template.match(new RegExp(`<c:${name}(?:[ >])`, 'g')) ?? []).length === 1)
    && !template.includes('2024 年') && !template.includes('<c:v>1280</c:v>'));
  source.presentation.dispose();

  const reopened = await fresh(core, edit, saved, 'chart-empty-reopen-');
  const empty = chart.queryChartData(reopened.doc, sourceId);
  check('删空保存重开仍保留可编辑锚点', empty.series.length === 0
    && empty.plotKinds.includes('bar') && empty.binding.mode === 'workbook');
  const reopenedEditor = new edit.Editor(reopened.doc);
  const reopenedApi = chart.createChartDataEditor(reopenedEditor);
  const seriesId = reopenedApi.addSeries(sourceId, '重开重建系列', 'bar');
  reopenedApi.setValue(sourceId, seriesId, empty.categories[0].id, 5151);
  const rebuilt = await reopenedEditor.save();
  writeFileSync(join(root, 'out/v08-integration', V08_OFFICE_ARTIFACTS[1].file), rebuilt);
  const rebuiltXml = decoder.decode(unzipSync(rebuilt)['ppt/charts/chart1.xml']);
  const rebuiltSeries = rebuiltXml.match(/<c:ser[ >][\s\S]*?<\/c:ser>/)?.[0]
    ?? rebuiltXml.match(/<c:ser>[\s\S]*?<\/c:ser>/)?.[0] ?? '';
  check('模板重建系列保持 OOXML 单例结构', singletons.every((name) =>
    (rebuiltSeries.match(new RegExp(`<c:${name}(?:[ >])`, 'g')) ?? []).length === 1));
  reopened.presentation.dispose();
  const final = await fresh(core, edit, rebuilt, 'chart-empty-reopen-');
  const finalData = chart.queryChartData(final.doc, sourceId);
  eq('删空保存重开后可再次新增并保存', finalData.series[0]?.name, '重开重建系列');
  eq('重建后的工作簿绑定仍可继续编辑', finalData.binding.mode, 'workbook');
  final.presentation.dispose();
}

async function testIndexesAndNamespaces({ core, edit, chart, bytes, check, eq }) {
  const malformed = mutatePart(bytes, 'ppt/charts/chart1.xml', (source) => {
    let xml = replaceOccurrence(source, '<c:idx val="1"/>', 1, '<c:idx/>');
    xml = replaceOccurrence(xml, '<c:order val="1"/>', 1, '<c:order/>');
    return xml.replace('<c:pt idx="0"><c:v>1280</c:v></c:pt>',
      '<c:pt idx="0"><c:v>1280</c:v></c:pt><c:pt><c:v>9999</c:v></c:pt>');
  });
  const malformedOpen = await fresh(core, edit, malformed, 'chart-missing-index-');
  const malformedData = chart.queryChartData(malformedOpen.doc, chart.listEditableCharts(malformedOpen.doc)[0].id);
  check('缺失系列索引回退 XML 次序且缺失点索引不覆盖点零',
    malformedData.series[1].id.endsWith(':s1') && malformedData.series[0].points[0].value === 1280);
  malformedOpen.presentation.dispose();

  const spoofed = mutatePart(bytes, 'ppt/charts/chart1.xml', (source) => source.replace(
    '<c:val><c:numRef>',
    `<c:val><strict:numRef xmlns:strict="${STRICT_CHART}"><strict:f>SECRET</strict:f>`
      + '<strict:numCache><strict:ptCount val="1"/><strict:pt idx="0"><strict:v>999</strict:v>'
      + '</strict:pt></strict:numCache></strict:numRef><c:numRef>',
  ));
  const spoofedOpen = await fresh(core, edit, spoofed, 'chart-cross-dialect-');
  const spoofedId = chart.listEditableCharts(spoofedOpen.doc)[0].id;
  const spoofedData = chart.queryChartData(spoofedOpen.doc, spoofedId);
  const spoofedEditor = new edit.Editor(spoofedOpen.doc);
  chart.createChartDataEditor(spoofedEditor).setValue(
    spoofedId, spoofedData.series[0].id, spoofedData.categories[0].id, 4343,
  );
  const projection = JSON.stringify(spoofedEditor.effectiveElement(spoofedId));
  const clean = await fresh(core, edit, bytes, 'chart-cross-dialect-');
  const cleanId = chart.listEditableCharts(clean.doc)[0].id;
  const cleanData = chart.queryChartData(clean.doc, cleanId);
  const cleanEditor = new edit.Editor(clean.doc);
  chart.createChartDataEditor(cleanEditor).setValue(
    cleanId, cleanData.series[0].id, cleanData.categories[0].id, 4343,
  );
  const cleanProjection = JSON.stringify(cleanEditor.effectiveElement(cleanId));
  const spoofedXml = decoder.decode(unzipSync(await spoofedEditor.save())['ppt/charts/chart1.xml']);
  const saveSafe = spoofedXml.includes('<strict:v>999</strict:v>')
    && spoofedXml.includes('<c:v>4343</c:v>');
  check('另一官方方言同名节点不能劫持查询、投影或保存',
    spoofedData.series[0].points[0].value === 1280 && projection === cleanProjection && saveSafe);
  clean.presentation.dispose();
  spoofedOpen.presentation.dispose();

  const sheetSpoof = mutateWorkbook(bytes, (parts) => {
    const source = decoder.decode(parts['xl/worksheets/sheet1.xml']);
    parts['xl/worksheets/sheet1.xml'] = encoder.encode(source.replace(
      '<c r="B2" s="1"><v>1280</v></c>',
      `<c r="B2" s="1"><v>1280</v><strict:v xmlns:strict="${STRICT_SHEET}">999</strict:v></c>`,
    ));
  });
  const sheetOpen = await fresh(core, edit, sheetSpoof, 'chart-sheet-dialect-');
  eq('工作表跨方言同名节点使目标区域保守只读',
    chart.queryChartData(sheetOpen.doc, chart.listEditableCharts(sheetOpen.doc)[0].id).binding.mode,
    'readonly');
  sheetOpen.presentation.dispose();

  const locatorParts = unzipSync(bytes);
  locatorParts['ppt/slides/slide1.xml'] = encoder.encode(
    decoder.decode(locatorParts['ppt/slides/slide1.xml']).replace(
      '<p:cNvGraphicFramePr/>',
      `<p:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">`
        + '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" '
        + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId99"/>'
        + '</a:graphicData></a:graphic></p:cNvGraphicFramePr>',
    ),
  );
  const slideRels = 'ppt/slides/_rels/slide1.xml.rels';
  locatorParts[slideRels] = encoder.encode(decoder.decode(locatorParts[slideRels]).replace(
    '</Relationships>',
    '<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" '
      + 'Target="../charts/chart2.xml"/></Relationships>',
  ));
  const locatorOpen = await fresh(core, edit, zipSync(locatorParts, { level: 0 }), 'chart-locator-path-');
  const located = chart.queryChartData(locatorOpen.doc, chart.listEditableCharts(locatorOpen.doc)[0].id);
  check('图表定位只接受 graphicFrame 的精确直系结构',
    located.binding.chartPart === 'ppt/charts/chart1.xml' && located.series[0].points[0].value === 1280);
  locatorOpen.presentation.dispose();
}

async function testWorkbookAndTextSafety({ core, edit, chart, bytes, check, eq }) {
  const invalid = await fresh(core, edit, bytes, 'chart-invalid-text-');
  const invalidId = chart.listEditableCharts(invalid.doc)[0].id;
  const invalidData = chart.queryChartData(invalid.doc, invalidId);
  const invalidEditor = new edit.Editor(invalid.doc);
  const invalidApi = chart.createChartDataEditor(invalidEditor);
  let controlsRejected = 0;
  for (const name of ['坏\0名称', '坏\uD800名称']) {
    try { invalidApi.setSeriesName(invalidId, invalidData.series[0].id, name); } catch { controlsRejected++; }
  }
  eq('名称拒绝 XML 1.0 非法控制字符与孤立代理项', controlsRejected, 2);
  invalidApi.setSeriesName(invalidId, invalidData.series[0].id, '合法😀名称');
  const validSaved = await invalidEditor.save();
  invalid.presentation.dispose();
  const validOpen = await fresh(core, edit, validSaved, 'chart-invalid-text-');
  eq('合法补充平面字符保存重开不被误伤',
    chart.queryChartData(validOpen.doc, invalidId).series[0].name, '合法😀名称');
  validOpen.presentation.dispose();

  const formula = mutateWorkbook(bytes, (parts) => {
    const source = decoder.decode(parts['xl/worksheets/sheet1.xml']);
    parts['xl/worksheets/sheet1.xml'] = encoder.encode(source.replace(
      '<row r="1">', '<row r="1"><c r="A1"><f t="array" ref="A1:C5">1</f><v>0</v></c>',
    ));
  });
  const formulaOpen = await fresh(core, edit, formula, 'chart-array-formula-');
  eq('数组公式覆盖区不能被图表工作簿写回',
    chart.queryChartData(formulaOpen.doc, chart.listEditableCharts(formulaOpen.doc)[0].id).binding.mode,
    'readonly');
  formulaOpen.presentation.dispose();

  for (const [label, mutate] of [
    ['缺失工作表 part', (parts) => { delete parts['xl/worksheets/sheet1.xml']; }],
    ['外部工作表关系', (parts) => {
      const path = 'xl/_rels/workbook.xml.rels';
      parts[path] = encoder.encode(decoder.decode(parts[path]).replace(
        'Target="worksheets/sheet1.xml"', 'Target="worksheets/sheet1.xml" TargetMode="External"'));
    }],
    ['重复工作表名称', (parts) => {
      const path = 'xl/workbook.xml';
      parts[path] = encoder.encode(decoder.decode(parts[path]).replace('</sheets>',
        '<sheet name="Sheet1" sheetId="99" r:id="rId2"/></sheets>'));
    }],
    ['重复工作簿关系身份', (parts) => {
      const path = 'xl/_rels/workbook.xml.rels';
      parts[path] = encoder.encode(decoder.decode(parts[path]).replace('</Relationships>',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
          + 'Target="worksheets/sheet2.xml"/></Relationships>'));
    }],
    ['缺失工作表行号', (parts) => {
      const path = 'xl/worksheets/sheet1.xml';
      parts[path] = encoder.encode(decoder.decode(parts[path]).replace('<row r="2">', '<row>'));
    }],
    ['重复工作表单元格地址', (parts) => {
      const path = 'xl/worksheets/sheet1.xml';
      parts[path] = encoder.encode(decoder.decode(parts[path]).replace(
        '<c r="B2" s="1"><v>1280</v></c>',
        '<c r="B2" s="1"><v>1280</v></c><c r="B2"><v>999</v></c>'));
    }],
  ]) {
    const opened = await fresh(core, edit, mutateWorkbook(bytes, mutate), `chart-${label}-`);
    eq(`${label}在资格阶段明确只读`,
      chart.queryChartData(opened.doc, chart.listEditableCharts(opened.doc)[0].id).binding.mode,
      'readonly');
    opened.presentation.dispose();
  }
}

async function testCategoryConsistency({ core, edit, chart, bytes, cacheBytes, eq }) {
  const mismatch = mutatePart(cacheBytes, 'ppt/charts/chart1.xml', (source) =>
    replaceOccurrence(source, '<c:v>第一季度</c:v>', 2, '<c:v>异类季度</c:v>'));
  const mismatchOpen = await fresh(core, edit, mismatch, 'chart-category-mismatch-');
  eq('缓存模式各系列类别值不一致时只读',
    chart.queryChartData(mismatchOpen.doc, chart.listEditableCharts(mismatchOpen.doc)[0].id).binding.mode,
    'readonly');
  mismatchOpen.presentation.dispose();

  const mixed = mutatePart(bytes, 'ppt/charts/chart1.xml', (source) => {
    let xml = replaceOccurrence(source, '<c:strCache>', 4, '<c:numCache>');
    xml = replaceOccurrence(xml, '</c:strCache>', 4, '</c:numCache>');
    xml = replaceOccurrence(xml, '<c:cat><c:strRef>', 2, '<c:cat><c:numRef>');
    return replaceOccurrence(xml, '</c:strRef></c:cat>', 2, '</c:numRef></c:cat>');
  });
  const mixedOpen = await fresh(core, edit, mixed, 'chart-category-kind-');
  eq('各系列类别缓存类型不一致时只读',
    chart.queryChartData(mixedOpen.doc, chart.listEditableCharts(mixedOpen.doc)[0].id).binding.mode,
    'readonly');
  mixedOpen.presentation.dispose();
}

async function testNumericCategoryLexical({ core, edit, chart, bytes, check }) {
  const numeric = mutatePart(bytes, 'ppt/charts/chart1.xml', numericCategoryChart);
  const opened = await fresh(core, edit, numeric, 'chart-numeric-lexical-');
  const chartId = chart.listEditableCharts(opened.doc)[0].id;
  const data = chart.queryChartData(opened.doc, chartId);
  const editor = new edit.Editor(opened.doc);
  const api = chart.createChartDataEditor(editor);
  ['01', '0x10', ' 3 '].forEach((label, index) =>
    api.setCategoryLabel(chartId, data.categories[index].id, label));
  const saved = await editor.save();
  const parts = unzipSync(saved);
  const chartXml = decoder.decode(parts['ppt/charts/chart1.xml']);
  const workbook = unzipSync(parts['ppt/embeddings/chart-data.xlsx']);
  const strings = decoder.decode(workbook['xl/sharedStrings.xml']);
  const sheet = decoder.decode(workbook['xl/worksheets/sheet1.xml']);
  opened.presentation.dispose();
  const reopened = await fresh(core, edit, saved, 'chart-numeric-lexical-');
  const labels = chart.queryChartData(reopened.doc, chartId).categories.map((item) => item.label);
  const evidence = {
    ref: chartXml.includes('<c:cat><c:strRef>'), chart01: chartXml.includes('<c:v>01</c:v>'),
    chartHex: chartXml.includes('<c:v>0x10</c:v>'), chartSpace: chartXml.includes('<c:v> 3 </c:v>'),
    string01: strings.includes('>01<'), stringHex: strings.includes('>0x10<'),
    stringSpace: `${strings}${sheet}`.includes('xml:space="preserve"> 3 </'), labels: labels.slice(0, 3),
  };
  check('非规范十进制类别统一切换字符串缓存与工作簿单元格',
    Object.values(evidence).slice(0, -1).every(Boolean)
      && JSON.stringify(evidence.labels) === JSON.stringify(['01', '0x10', ' 3 ']),
    JSON.stringify(evidence));
  reopened.presentation.dispose();
}

async function testUntrustedTemplate({ core, edit, chart, bytes, check, eq }) {
  const categories = ['template-category-0', 'template-category-1',
    'template-category-2', 'template-category-3'];
  const manifest = JSON.stringify({
    categories,
    series: [{ id: 'template-physical-a', points: [] }, { id: 'template-physical-b', points: [] }],
    templates: [{ id: 'forged-template', plotKind: 'bar', sourceIndex: 99, points: [] }],
  });
  const forgedChart = mutatePart(bytes, 'ppt/charts/chart1.xml', (source) => {
    const template = source.match(/<c:ser>[\s\S]*?<\/c:ser>/)?.[0]
      .replace('<c:idx val="0"/>', '<c:idx val="99"/>')
      .replace('<c:order val="0"/>', '<c:order val="99"/>')
      .replace('Sheet1!$B$1', 'Sheet1!$Z$99')
      .replace('Sheet1!$B$2:$B$5', 'Sheet1!$Z$100:$Z$103');
    if (!template) throw new Error('缺少伪造模板来源系列');
    return source.replace('</c:chartSpace>',
      `<c:extLst><c:ext uri="${IDENTITY_URI}"><wppt:ids xmlns:wppt="${IDENTITY_URI}">`
        + `${manifest}</wppt:ids><wppt:template xmlns:wppt="${IDENTITY_URI}" id="forged-template">`
        + `${template}</wppt:template></c:ext></c:extLst></c:chartSpace>`);
  });
  const forged = mutateWorkbook(forgedChart, (parts) => {
    const path = 'xl/worksheets/sheet1.xml';
    parts[path] = encoder.encode(decoder.decode(parts[path]).replace('</sheetData>',
      '<row r="100"><c r="Z100" t="inlineStr"><is><t>SECRET</t></is></c></row></sheetData>'));
  });
  const opened = await fresh(core, edit, forged, 'chart-forged-template-');
  const chartId = chart.listEditableCharts(opened.doc)[0].id;
  eq('输入文件伪造模板不能取得已占用单元格所有权',
    chart.queryChartData(opened.doc, chartId).binding.mode, 'readonly');
  const saved = await new edit.Editor(opened.doc).save();
  const sheet = decoder.decode(unzipSync(
    unzipSync(saved)['ppt/embeddings/chart-data.xlsx'],
  )['xl/worksheets/sheet1.xml']);
  check('伪造模板的目标单元格保存后保持原值', sheet.includes('<t>SECRET</t>'));
  opened.presentation.dispose();
}

async function testLargeIdentityManifest({ core, edit, chart, bytes, check }) {
  const categories = Array.from({ length: 9_000 }, (_, index) =>
    `category-${String(index).padStart(5, '0')}-${'x'.repeat(450)}`);
  const manifest = JSON.stringify({
    categories,
    series: [{ id: 'large-series-a', points: [] }, { id: 'large-series-b', points: [] }],
    templates: [],
  });
  const expanded = mutatePart(bytes, 'ppt/charts/chart1.xml', (source) => source.replace(
    '</c:chartSpace>',
    `<c:extLst><c:ext uri="${IDENTITY_URI}"><wppt:ids xmlns:wppt="${IDENTITY_URI}">`
      + `${manifest}</wppt:ids></c:ext></c:extLst></c:chartSpace>`,
  ));
  const opened = await fresh(core, edit, expanded, 'chart-large-manifest-');
  const chartId = chart.listEditableCharts(opened.doc)[0].id;
  const data = chart.queryChartData(opened.doc, chartId);
  const editor = new edit.Editor(opened.doc);
  chart.createChartDataEditor(editor).setValue(chartId, data.series[0].id, data.categories[0].id, 8181);
  const saved = await editor.save();
  opened.presentation.dispose();
  const reopened = await fresh(core, edit, saved, 'chart-large-manifest-');
  const reopenedData = chart.queryChartData(reopened.doc, chartId);
  check('超过旧 4MiB 的合法身份清单保存重开仍稳定',
    manifest.length > 4 * 1024 * 1024 && reopenedData.categories.length === categories.length
      && reopenedData.categories.at(-1)?.id === categories.at(-1));
  reopened.presentation.dispose();
}

async function testCommandContract({ core, edit, chart, bytes, check }) {
  const opened = await fresh(core, edit, bytes, 'chart-command-contract-');
  const datasets = chart.listEditableCharts(opened.doc).map((item) => chart.queryChartData(opened.doc, item.id));
  const bar = datasets.find((item) => item.series.some((series) => series.plotKind === 'bar'));
  const scatter = datasets.find((item) => item.series.some((series) => series.plotKind === 'scatter'));
  const editor = new edit.Editor(opened.doc);
  const api = chart.createChartDataEditor(editor);
  let rejected = 0;
  const barSeries = bar.series.find((series) => series.plotKind === 'bar');
  const scatterSeries = scatter.series.find((series) => series.plotKind === 'scatter');
  for (const run of [
    () => api.setPoint(bar.chartId, barSeries.id, barSeries.points[0].id, { x: 42 }),
    () => api.setPoint(bar.chartId, barSeries.id, barSeries.points[0].id, { size: 3 }),
    () => api.setPoint(scatter.chartId, scatterSeries.id, scatterSeries.points[0].id, { size: 3 }),
  ]) {
    try { run(); } catch { rejected++; }
  }
  check('本地图表点命令拒绝图种不适用字段', rejected === 3
    && !opened.doc.elements[bar.chartId].ovr.extensions
    && !opened.doc.elements[scatter.chartId].ovr.extensions);
  opened.presentation.dispose();

  const upperBytes = mutatePart(bytes, 'ppt/charts/chart1.xml', (source) =>
    source.replace('<c:idx val="0"/>', '<c:idx val="2147483647"/>'));
  const upper = await fresh(core, edit, upperBytes, 'chart-upper-index-');
  const upperId = chart.listEditableCharts(upper.doc)[0].id;
  const upperEditor = new edit.Editor(upper.doc);
  const added = chart.createChartDataEditor(upperEditor).addSeries(upperId, '上界后新增');
  const addedSeries = chart.queryChartData(upper.doc, upperId).series.find((series) => series.id === added);
  const upperXml = decoder.decode(unzipSync(await upperEditor.save())['ppt/charts/chart1.xml']);
  check('来源系列索引达上界时从最小空闲索引新增',
    addedSeries?.sourceIndex === 0 && upperXml.includes('<c:idx val="0"/>')
      && upperXml.includes('上界后新增'));
  upper.presentation.dispose();
}

export async function testChartDataRoundTripBoundaries(context) {
  await testEmptyRoundTrip(context);
  await testIndexesAndNamespaces(context);
  await testWorkbookAndTextSafety(context);
  await testCategoryConsistency(context);
  await testNumericCategoryLexical(context);
  await testUntrustedTemplate(context);
  await testLargeIdentityManifest(context);
  await testCommandContract(context);
}
