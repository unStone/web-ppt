import { unzipSync, strFromU8 } from 'fflate';

export async function testSharedNativeParts({ core, edit, chart, input, assert }) {
  const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(presentation)), api = chart.createChartDataEditor(editor);
  const frames = chart.listEditableCharts(editor.doc), first = chart.queryChartData(editor.doc, frames[0].id);
  editor.exec({ type: 'RemoveElement', id: frames[1].id });
  api.setValue(frames[0].id, first.series[0].id, first.categories[1].id, 808);
  api.removeSeries(frames[0].id, first.series[0].id);
  const saved = unzipSync(await editor.save()), workbook = unzipSync(saved['ppt/embeddings/hierarchy1.xlsx']);
  assert.match(strFromU8(workbook['xl/worksheets/sheet1.xml']), /<c r="C3"><v>808<\/v><\/c>/,
    '删除框架没有删除仍存在的原生图表部件，其引用继续参与所有权判断');
  assert.match(strFromU8(saved['ppt/charts/chart2.xml']), /<c:val>[\s\S]*?<c:pt idx="1"><c:v>808<\/c:v>/,
    '没有当前框架的原生图表缓存也同步共享数据');
  editor.undo(); editor.undo();
  const undone = unzipSync(await editor.save()), source = unzipSync(input);
  assert.deepEqual(undone['ppt/charts/chart2.xml'], source['ppt/charts/chart2.xml'],
    '撤销后恢复未挂载图表部件的原始字节');
  editor.dispose(); presentation.dispose();
}
