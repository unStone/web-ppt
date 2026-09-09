export async function testSharedRows({ core, edit, chart, input, assert }) {
  const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(presentation)), api = chart.createChartDataEditor(editor);
  const ids = chart.listEditableCharts(editor.doc).map(item => item.id);
  const views = () => ids.map(id => chart.queryChartData(editor.doc, id));
  const original = views();
  api.removeCategory(ids[0], original[0].categories[0].id);
  assert.deepEqual(views().map(data => data.series[0].points.map(point => point.value)),
    [[10, 20, null, 40], [10, 20, null], [10, 20, null, 40]], '删除范围首行后局部视图保留自己的原有记录');
  api.setValue(ids[1], original[1].series[0].id, original[1].categories[1].id, 998);
  assert.deepEqual(views().map(data => data.series[0].points.map(point => point.value)),
    [[10, 998, null, 40], [10, 998, null], [10, 998, null, 40]], '删除前序行后用原有身份编辑仍命中同一记录');
  api.setCategoryLabel(ids[1], original[1].categories[1].id, 'Only South');
  assert.deepEqual(views().map(data => data.categories.map(category => category.label)),
    [['A', 'Only South', '', '0'], ['A', 'Only South', ''], ['A', 'Only South', '', '0']],
    '压紧范围后改叶标签只命中原记录，不会再写一次旧物理行');
  const expected = views().map(data => data.categories.map(category => category.id));
  const saved = await editor.save();
  const reopened = await core.parse(saved, { edit: true, keepPackage: true, lazy: false }), doc = edit.createDoc(reopened);
  const actual = chart.listEditableCharts(doc).map(item => chart.queryChartData(doc, item.id));
  assert.ok(actual.every(data => data.binding.mode === 'workbook'));
  assert.deepEqual(actual.map(data => data.categories.map(category => category.id)), expected);
  assert.deepEqual(actual.map(data => data.series[0].points.map(point => point.value)),
    [[10, 998, null, 40], [10, 998, null], [10, 998, null, 40]]);
  editor.undo(); editor.undo(); editor.undo();
  assert.deepEqual(views().map(data => data.series[0].points.map(point => point.value)),
    original.map(data => data.series[0].points.map(point => point.value)), '保存后整体撤销共享删行');
  editor.dispose(); presentation.dispose(); reopened.dispose();
}
