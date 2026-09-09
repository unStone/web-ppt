export async function testSharedViews({ core, edit, chart, input, assert }) {
  const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(presentation)), ids = chart.listEditableCharts(editor.doc).map(item => item.id);
  const views = () => ids.map(id => chart.queryChartData(editor.doc, id));
  assert.deepEqual(views().map(data => data.categories.length), [5, 3, 5]);
  assert.ok(views().every(data => data.binding.mode === 'workbook'));
  const partial = views()[1];
  chart.createChartDataEditor(editor).setValue(ids[1], partial.series[0].id, partial.series[0].points[0].id, 456);
  assert.deepEqual(views().map(data => data.series[0].points.map(point => point.value)),
    [[0, 456, 20, null, 40], [456, 20, null], [0, 456, 20, null, 40]], '重叠范围按实际单元格寻址，不按图表本地行号');
  const saved = await editor.save(), reopened = await core.parse(saved, { edit: true, keepPackage: true, lazy: false });
  const doc = edit.createDoc(reopened);
  assert.deepEqual(chart.listEditableCharts(doc).map(item => chart.queryChartData(doc, item.id).series[0].points[0].value),
    [0, 456, 0], '局部视图保存不会覆盖同一工作簿的其他行');
  editor.dispose(); presentation.dispose(); reopened.dispose();
}
