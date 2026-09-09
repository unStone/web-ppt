import { unzipSync, strFromU8 } from 'fflate';

export async function testSharedCacheNative({ core, edit, chart, input, assert }) {
  const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(presentation)), api = chart.createChartDataEditor(editor);
  const frames = chart.listEditableCharts(editor.doc).filter(frame => frame.binding.chartPart === 'ppt/charts/chart1.xml');
  const first = chart.queryChartData(editor.doc, frames[0].id);
  api.setValue(first.chartId, first.series[0].id, first.categories[1].id, 927);
  for (const frame of frames) editor.exec({ type: 'RemoveElement', id: frame.id });
  const saved = unzipSync(await editor.save());
  assert.match(strFromU8(saved['ppt/charts/chart1.xml']), /<c:val>[\s\S]*?<c:pt idx="1"><c:v>927<\/c:v>/,
    '最后一个共享缓存框架删除后，部件仍参与原子保存');
  editor.undo(); editor.undo();
  assert.deepEqual(frames.map(frame => chart.queryChartData(editor.doc, frame.id).series[0].points[1].value), [927, 927]);
  editor.undo();
  assert.deepEqual(unzipSync(await editor.save())['ppt/charts/chart1.xml'], unzipSync(input)['ppt/charts/chart1.xml'],
    '恢复框架并撤销缓存编辑后还原原始部件');
  editor.dispose(); presentation.dispose();
}
