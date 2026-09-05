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
  for (const file of manifest.files) {
    const report = probe(file.name);
    assert.ok(report.charts.length, `${file.name} 必须有实际 ChartEx`);
    for (const chart of report.charts) for (const dim of chart.dimensions) {
      assert.equal(dim.workbookReferences.length, 1);
      assert.equal(dim.workbookReferences[0].status, 'resolved', `${file.name} 的 ${dim.dataId}/${dim.type}`);
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
