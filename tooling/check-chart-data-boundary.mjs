/** 图表编辑与 SpreadsheetML 补丁器只能从 chart 子路径进入，默认入口保持零静态引入。 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const size = (source) => ({
  raw: Buffer.byteLength(source), gzip: gzipSync(Buffer.from(source)).length,
});
const forbidden = ['chart-data', '内嵌工作簿缺少 workbook 关系'];
for (const file of [
  'packages/edit-core/dist/edit-core.js', 'packages/editor/dist/editor.js',
  'packages/react/dist/react.js', 'packages/vue/dist/vue.js',
]) {
  const source = read(file);
  const leaked = forbidden.find((sentinel) => source.includes(sentinel));
  if (leaked) throw new Error(`${file} 静态引入了图表数据实现：${leaked}`);
}

const coreMain = read('packages/core/dist/core.js');
const coreMainSize = size(coreMain);
const coreBaseline = { raw: 307_344, gzip: 93_962 };
if (coreMainSize.raw > coreBaseline.raw || coreMainSize.gzip > coreBaseline.gzip) {
  throw new Error(`core 默认入口体积回归：${JSON.stringify({ coreBaseline, coreMainSize })}`);
}

const coreChart = read('packages/core/dist/chart-edit.js');
const coreChartBudget = { raw: 85_000, gzip: 26_000 };
const coreChartSize = size(coreChart);
if (coreChartSize.raw > coreChartBudget.raw || coreChartSize.gzip > coreChartBudget.gzip) {
  throw new Error(`core/chart-edit 体积超出预算：${JSON.stringify({ coreChartBudget, coreChartSize })}`);
}

const implementation = read('packages/edit-core/dist/chart.js');
if (!forbidden.every((sentinel) => implementation.includes(sentinel))) {
  throw new Error('edit-core/chart 缺少图表数据或 SpreadsheetML 实现');
}
if (!['@web-ppt/edit-core', '@web-ppt/edit-core/xml', '@web-ppt/edit-core/opc']
  .every((entry) => implementation.includes(`from "${entry}"`))) {
  throw new Error('edit-core/chart 没有复用身份、分数序或 XML / OPC 入口');
}
const budget = { raw: 85_000, gzip: 25_000 };
const actual = size(implementation);
if (actual.raw > budget.raw || actual.gzip > budget.gzip) {
  throw new Error(`edit-core/chart 体积超出预算：${JSON.stringify({ budget, actual })}`);
}
for (const [file, external] of [
  ['packages/editor/dist/chart.js', '@web-ppt/edit-core/chart'],
  ['packages/react/dist/chart.js', '@web-ppt/editor/chart'],
  ['packages/vue/dist/chart.js', '@web-ppt/editor/chart'],
]) {
  const source = read(file);
  if (!source.includes(`from "${external}"`) || Buffer.byteLength(source) > 512) {
    throw new Error(`${file} 不是 ${external} 的薄转发入口`);
  }
}
console.log(`图表按需入口边界通过：core ${coreChartSize.raw}/${coreChartSize.gzip}B，edit-core ${actual.raw}/${actual.gzip}B`);
