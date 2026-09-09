import { unzipSync, strFromU8 } from 'fflate';

export async function testSharedSeries({ core, edit, chart, input, assert }) {
  const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(presentation)), api = chart.createChartDataEditor(editor);
  const ids = chart.listEditableCharts(editor.doc).map(item => item.id);
  const original = ids.map(id => chart.queryChartData(editor.doc, id));
  const counts = () => ids.map(id => chart.queryChartData(editor.doc, id).series.length);
  api.removeSeries(ids[0], original[0].series[0].id);
  assert.deepEqual(counts(), [1, 2, 1], '系列列表属于图表部件，修改同时更新该部件的全部框架');
  api.removeSeries(ids[2], original[2].series[1].id);
  assert.deepEqual(counts(), [0, 2, 0]);
  const firstSave = await editor.save();
  const book = unzipSync(unzipSync(firstSave)['ppt/embeddings/hierarchy1.xlsx']);
  assert.match(strFromU8(book['xl/worksheets/sheet1.xml']), /<c r="C3"><v>10<\/v><\/c>/,
    '删空一个图表的系列仍保留另一图表引用的数据');
  const verify = async (bytes, expected) => {
    const opened = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false }), doc = edit.createDoc(opened);
    const data = chart.listEditableCharts(doc).map(item => chart.queryChartData(doc, item.id));
    assert.deepEqual(data.map(item => item.series.length), expected);
    assert.ok(data.every(item => item.binding.mode === 'workbook'), '持久模板只借用已证明的共享所有权，重开仍可编辑');
    opened.dispose();
  };
  await verify(firstSave, [0, 2, 0]);
  api.removeSeries(ids[1], original[1].series[0].id);
  api.removeSeries(ids[1], original[1].series[1].id);
  const empty = await editor.save();
  await verify(empty, [0, 0, 0]);
  const emptySheet = strFromU8(unzipSync(unzipSync(empty)['ppt/embeddings/hierarchy1.xlsx'])['xl/worksheets/sheet1.xml']);
  assert.doesNotMatch(emptySheet, /<c r="C3"[^>]*>[\s\S]*?<v>10<\/v>/);
  assert.match(emptySheet, /<t>KEEP<\/t>/, '所有系列删空也保留无关工作表内容');
  editor.undo();
  assert.deepEqual(counts(), [0, 1, 0], '保存后撤销只恢复指定图表的指定系列');
  await verify(await editor.save(), [0, 1, 0]);
  editor.dispose(); presentation.dispose();
}
