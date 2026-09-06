/** 经 CLI 观察真实工作簿引用；不把整表统计或人工对照当作 Office 图表数据。 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workbookProbeBytes, workbookProbeFixture } from './lib/chartex-workbook-probe-fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../fixtures/chartex-corpus.json', import.meta.url)));
const probe = (name) => {
  const source = manifest.files.find((file) => file.name === name);
  const bytes = readFileSync(new URL(`../${source.downloadPath}`, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256);
  const result = spawnSync(process.execPath, ['tooling/probe-chartex.mjs', source.downloadPath],
    { cwd: root, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

if (process.argv.includes('--corpus')) {
  const waterfall = probe('waterfall.xlsx');
  const waterfallData = waterfall.charts[0].dimensions[0].workbookReferences?.[0];
  assert.equal(waterfallData?.status, 'resolved', '无缓存维度必须能追溯到定义名称指向的数据');
  assert.equal(waterfallData.reference, 'Sheet1!$C$4:$C$15');
  assert.deepEqual(waterfallData.rows.map((row) => row[0].value), [2, 5, 4, 6, -5, -6, -4, 7, 8, 6, 7, 5]);
  assert.equal(waterfall.fallbackSerialization, 'not-applicable', '读到 XLSX 数据不代表 PPTX 回退通过');
  const hierarchy = probe('treemap.xlsx').charts[0].dimensions[0].workbookReferences[0];
  assert.equal(hierarchy.reference, 'Sheet1!$B$4:$D$14');
  assert.equal(hierarchy.rows.length, 11);
  assert.deepEqual(hierarchy.rows.map((row) => row.map((cell) => cell.value)), [
    ['Best', 'First', 'A'], [null, null, 'B'], [null, null, 'C'], [null, null, 'D'], [null, null, 'E'],
    [null, 'Second', 'C'], [null, null, 'D'], ['Worst', 'Third', 'E'], [null, 'Fourth', null],
    [null, 'Fifth', null], [null, 'Sixth', 'F'],
  ], '共享字符串索引不是数值，层级空单元格和重复标签不能丢失');
  assert.equal(hierarchy.rows[1][0].kind, 'missing');
  assert.equal(hierarchy.rows[0][0].kind, 'string');
  const funnel = probe('funnel-pp1.pptx').charts[0];
  assert.equal(funnel.workbookSource.kind, 'embedded', 'PPTX 必须沿图表关系打开内嵌工作簿');
  assert.equal(funnel.dimensions[0].workbookReferences[0].status, 'resolved');
  assert.deepEqual(funnel.dimensions[0].workbookReferences[0].rows.map((row) => row[0].value),
    ['Thing 1', 'Thing 2', 'Thing 3', 'Thing 4']);
  assert.equal(funnel.dimensions.length, 6);
  for (const dimension of funnel.dimensions) {
    assert.equal(dimension.inlineData.source, 'cache');
    assert.deepEqual(dimension.sourceComparison, { status: 'equal', compared: 4 },
      '真实 PowerPoint 漏斗的六个缓存维度均与内嵌工作簿逐点一致');
  }
  for (const file of manifest.files) {
    const report = probe(file.name);
    assert.ok(report.charts.length, `${file.name} 必须有实际 ChartEx`);
    for (const chart of report.charts) for (const dim of chart.dimensions) {
      assert.equal(dim.workbookReferences.length, 1);
      assert.equal(dim.workbookReferences[0].status, 'resolved', `${file.name} 的 ${dim.dataId}/${dim.type}`);
      if (report.container === 'xlsx') {
        assert.equal(dim.inlineData.status, 'absent', '原始 XLSX 未带 ChartEx 缓存');
        assert.equal(dim.workbookData.status, 'resolved');
        assert.deepEqual(dim.sourceComparison, { status: 'not-comparable', reason: 'inline-absent' });
      }
    }
  }
}
const temporary = mkdtempSync(join(tmpdir(), 'web-ppt-chartex-workbook-'));
try {
  const path = join(temporary, 'boundaries.xlsx');
  const inspect = (parts) => {
    writeFileSync(path, workbookProbeBytes(parts));
    const result = spawnSync(process.execPath, ['tooling/probe-chartex.mjs', path],
      { cwd: root, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.provenance, null, '人工边界不能冒充真实样本');
    return report.charts[0];
  };
  const parts = workbookProbeFixture();
  assert.deepEqual(workbookProbeBytes(parts), workbookProbeBytes(workbookProbeFixture()), '边界包字节必须确定');
  const withDimension = (xml, overrides = {}) => inspect({ ...parts, ...overrides,
    'chart/chart.xml': parts['chart/chart.xml'].replace(/<cx:numDim\b[^]*?<\/cx:numDim>/, xml),
  }).dimensions[0];
  const literal = withDimension('<cx:numDim type="val"><cx:lvl ptCount="4" name="数量" formatCode="0.0"><cx:pt idx="2">-3</cx:pt><cx:pt idx="0">0</cx:pt></cx:lvl></cx:numDim>');
  assert.deepEqual(literal.inlineData, {
    status: 'resolved', source: 'literal', levels: [{ count: 4, name: '数量', formatCode: '0.0', values: [
      { kind: 'number', value: 0 }, { kind: 'missing', value: null },
      { kind: 'number', value: -3 }, { kind: 'missing', value: null },
    ] }],
  }, '字面维度按 idx 对齐，稀疏槽不是零，XML 顺序不是数据顺序');
  for (const raw of ['', ' ', '0x10', 'NaN', 'INF', '-INF', '1e999']) {
    const numeric = withDimension(`<cx:numDim type="val"><cx:lvl ptCount="1"><cx:pt idx="0">${raw}</cx:pt></cx:lvl></cx:numDim>`);
    assert.deepEqual(numeric.inlineData.levels[0].values[0], { kind: 'invalid', value: null, raw },
      '不能把空数字变成零，非有限值也不能经 JSON 变成合法空值');
  }
  const cached = withDimension('<cx:numDim type="val"><cx:f>\'O\'\'Brien data\'!A1</cx:f><cx:lvl ptCount="1"><cx:pt idx="0">0</cx:pt></cx:lvl></cx:numDim>');
  assert.deepEqual(cached.workbookData, { status: 'resolved', direction: 'col', levels: [
    { count: 1, values: [{ address: 'A1', kind: 'number', value: 0 }] },
  ] }, '引用方向产生维度，来源单元格仍可追溯');
  assert.deepEqual(cached.sourceComparison, { status: 'equal', compared: 1 }, '缓存与工作簿独立读取后才能声称一致');
  const unknown = withDimension('<cx:numDim type="val"><cx:f>\'O\'\'Brien data\'!A9</cx:f><cx:lvl ptCount="1"><cx:pt idx="0"/></cx:lvl></cx:numDim>');
  assert.deepEqual(unknown.sourceComparison, { status: 'not-comparable', reason: 'unusable-values' },
    '两侧恰好都无效不等于数据一致');
  const nested = withDimension('<cx:numDim type="val"><cx:lvl ptCount="1"><cx:pt idx="0">7</cx:pt></cx:lvl><cx:extLst><cx:ext><cx:lvl ptCount="1"><cx:pt idx="0">999</cx:pt></cx:lvl><cx:f>data</cx:f></cx:ext></cx:extLst></cx:numDim>');
  assert.equal(nested.inlineData.source, 'literal', '扩展内部同名节点不属于维度的数据路径');
  assert.equal(nested.inlineData.levels.length, 1);
  const complexPoint = withDimension('<cx:numDim type="val"><cx:lvl ptCount="1"><cx:pt idx="0"><cx:v>7</cx:v></cx:pt></cx:lvl></cx:numDim>');
  assert.deepEqual(complexPoint.inlineData, { status: 'invalid', source: 'literal', reason: 'invalid-point-content' },
    'pt 的简单值不能通过拼接未知子元素伪造成合法数字');
  const differing = withDimension('<cx:numDim type="val"><cx:f>\'O\'\'Brien data\'!A1</cx:f><cx:lvl ptCount="1"><cx:pt idx="0">2.5e1</cx:pt></cx:lvl></cx:numDim>');
  assert.deepEqual(differing.sourceComparison, { status: 'different', compared: 1, differences: [
    { index: 0, inline: { kind: 'number', value: 25 }, workbook: { address: 'A1', kind: 'number', value: 0 } },
  ] }, '冲突报告两侧值及位置，不能静默选源');
  const emptyCache = withDimension('<cx:numDim type="val"><cx:f>\'O\'\'Brien data\'!A1</cx:f><cx:lvl ptCount="0"/></cx:numDim>');
  assert.deepEqual(emptyCache.sourceComparison, { status: 'different', reason: 'point-count', inlineCount: 0, workbookCount: 1 });
  const labels = withDimension('<cx:strDim type="cat"><cx:lvl ptCount="4"><cx:pt idx="3"> 重复 </cx:pt><cx:pt idx="2">重复</cx:pt><cx:pt idx="0"/></cx:lvl></cx:strDim>');
  assert.deepEqual(labels.inlineData.levels[0].values, [
    { kind: 'string', value: '' }, { kind: 'missing', value: null },
    { kind: 'string', value: '重复' }, { kind: 'string', value: ' 重复 ' },
  ], '空文本、缺槽、重复标签和空格各自保留');
  for (const [level, reason] of [
    ['<cx:lvl ptCount="1"><cx:pt idx="0">1</cx:pt><cx:pt idx="0">2</cx:pt></cx:lvl>', 'duplicate-point-index'],
    ['<cx:lvl ptCount="1"><cx:pt idx="1">1</cx:pt></cx:lvl>', 'invalid-point-index'],
    ['<cx:lvl ptCount="1"><cx:pt>1</cx:pt></cx:lvl>', 'invalid-point-index'],
    ['<cx:lvl ptCount="1"><cx:pt idx="-1">1</cx:pt></cx:lvl>', 'invalid-point-index'],
    ['<cx:lvl ptCount="1"><cx:pt idx="0.5">1</cx:pt></cx:lvl>', 'invalid-point-index'],
    ['<cx:lvl/>', 'invalid-point-count'],
    ['<cx:lvl ptCount="-1"/>', 'invalid-point-count'],
    ['<cx:lvl ptCount="4294967296"/>', 'invalid-point-count'],
    ['<cx:lvl ptCount="10001"/>', 'dimension-limit'],
    ['<cx:lvl ptCount="6000"/><cx:lvl ptCount="6000"/>', 'dimension-limit'],
  ]) {
    assert.deepEqual(withDimension(`<cx:numDim type="val">${level}</cx:numDim>`).inlineData,
      { status: 'invalid', source: 'literal', reason }, '结构歧义及累计上限必须在展开稀疏槽前拦住');
  }
  const matrix = { 'data/values.xml': '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>10</v></c><c r="B1"><v>20</v></c></row><row r="2"><c r="A2"><v>30</v></c><c r="B2"><v>40</v></c></row></sheetData></worksheet>' };
  for (const [direction, expected] of [['row', [[10, 20], [30, 40]]], ['col', [[10, 30], [20, 40]]]]) {
    const dimension = withDimension(`<cx:numDim type="val"><cx:f dir="${direction}">'O''Brien data'!A1:B2</cx:f><cx:lvl ptCount="2"><cx:pt idx="0">10</cx:pt><cx:pt idx="1">20</cx:pt></cx:lvl><cx:lvl ptCount="2"><cx:pt idx="0">30</cx:pt><cx:pt idx="1">40</cx:pt></cx:lvl></cx:numDim>`, matrix);
    assert.deepEqual(dimension.workbookData.levels.map((level) => level.values.map((cell) => cell.value)), expected);
    assert.deepEqual(dimension.sourceComparison, { status: 'not-comparable', reason: 'hierarchy-order-unverified' },
      '即使物理顺序碰巧一致，也不把未经证实的多层映射标成语义一致');
  }
  const badDirection = withDimension('<cx:numDim type="val"><cx:f dir="diagonal">data</cx:f></cx:numDim>');
  assert.deepEqual(badDirection.workbookData, { status: 'unresolved', reason: 'invalid-direction' });
  const duplicateFormula = withDimension('<cx:numDim type="val"><cx:f>data</cx:f><cx:f>data</cx:f><cx:lvl ptCount="0"/></cx:numDim>');
  assert.deepEqual(duplicateFormula.inlineData, { status: 'invalid', source: 'cache', reason: 'multiple-formulas' });
  assert.deepEqual(duplicateFormula.workbookData, { status: 'unresolved', reason: 'multiple-formulas' });
  const boundary = inspect(parts).dimensions[0].workbookReferences[0];
  assert.equal(boundary.direction, 'row', '引用方向与矩形数据分别保留，不私自转置或压平');
  assert.deepEqual(boundary.rows.map(([cell]) => [cell.kind, cell.value]), [
    ['number', 0], ['blank', null], ['missing', null], ['boolean', true], ['error', '#N/A'],
    ['number', 3], ['uncalculated', null], ['string', ''], ['invalid', null], ['string', '中文'],
    ['invalid', null], ['date', '2026-09-06'], ['string', '007'],
  ], '缺值、错误、公式缓存、注音与文本数字不能全部强转为数值');
  assert.equal(boundary.rows[5][0].formula, '1+2');
  assert.equal(boundary.rows[6][0].formula, '4+5');
  const reportReference = (value) => inspect({ ...parts,
    'chart/chart.xml': parts['chart/chart.xml'].replace('>data</cx:f>', `>${value}</cx:f>`),
  }).dimensions[0].workbookReferences[0];
  for (const reference of ['SUM(A1:A3)', "'[remote.xlsx]Sheet1'!A1", "'O''Brien data'!A1:A1048576", 'missingName']) {
    assert.equal(reportReference(reference).status, 'unresolved', `${reference} 不能伪造成已读取数据`);
  }
  const scoped = inspect({ ...parts, 'book/main.xml': parts['book/main.xml'].replace('name="data"', 'name="data" localSheetId="0"') });
  assert.equal(scoped.dimensions[0].workbookReferences[0].reason, 'ambiguous-name');
  const duplicate = inspect({ ...parts, 'data/values.xml': parts['data/values.xml'].replace('</row>', '<c r="A1"><v>999</v></c></row>') });
  assert.equal(duplicate.dimensions[0].workbookReferences[0].reason, 'duplicate-cell', '重复坐标不能静默选择最后一个');
  const external = inspect({ ...parts,
    'chart/chart.xml': parts['chart/chart.xml'].replace('<cx:chartData>', '<cx:chartData><cx:externalData r:id="remote"/>'),
    'chart/_rels/chart.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="remote" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="https://example.invalid/data.xlsx" TargetMode="External"/></Relationships>',
  });
  assert.equal(external.workbookSource.reason, 'external-workbook');
  assert.equal(external.dimensions[0].workbookReferences[0].status, 'unresolved');
  const presentationHost = inspect({ ...parts,
    'book/main.xml': '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',
  });
  assert.equal(presentationHost.workbookSource.kind, 'unavailable', 'officeDocument 不一定是工作簿，PPTX 不能伪造 Excel 宿主证据');
  assert.equal(presentationHost.dimensions[0].workbookReferences[0].reason, 'workbook-unavailable');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
console.log('ChartEx 工作簿探针契约通过');
