import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

export async function testSharedSources({ core, edit, chart, input, assert }) {
  const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(presentation)), frames = chart.listEditableCharts(editor.doc);
  const first = frames[0].id, bookPart = 'ppt/embeddings/hierarchy1.xlsx', original = editor.doc.package.parts[bookPart];
  const context = chart.chartProjection(editor.doc, first).context;
  context.rels.rId1.target = 'invalid.xlsx';
  assert.equal(chart.queryChartData(editor.doc, first).binding.mode, 'workbook', '公开投影上下文不能污染内部关系缓存');
  const workbook = unzipSync(original);
  workbook['xl/worksheets/sheet1.xml'] = strToU8(strFromU8(workbook['xl/worksheets/sheet1.xml'])
    .replace('<c r="C3"><v>10</v></c>', '<c r="C3"><v>999</v></c>'));
  editor.doc.package.parts[bookPart] = zipSync(workbook);
  assert.equal(chart.queryChartData(editor.doc, first).binding.mode, 'readonly', '工作簿来源替换必须使缓存和依赖校验失效');
  editor.doc.package.parts[bookPart] = original;
  assert.equal(chart.queryChartData(editor.doc, first).binding.mode, 'workbook');
  editor.exec({ type: 'RemoveElement', id: frames[1].id });
  const badPart = 'ppt/charts/chart2.xml', originalChart = editor.doc.package.parts[badPart];
  editor.doc.package.parts[badPart] = strToU8(strFromU8(originalChart)
    .replace(/<c:plotArea>[\s\S]*?<\/c:plotArea>/, '<c:plotAreaMissing/>'));
  let binding;
  assert.doesNotThrow(() => { binding = chart.queryChartData(editor.doc, first).binding; },
    '未挂载的损坏依赖不能击穿健康图表查询');
  assert.equal(binding.mode, 'readonly');
  assert.match(binding.reason, /chart2.xml.*plotArea/);
  editor.doc.package.parts[badPart] = originalChart;
  assert.equal(chart.queryChartData(editor.doc, first).binding.mode, 'workbook', '损坏依赖恢复后不保留过期只读结论');
  editor.dispose(); presentation.dispose();
}
