import { unzipSync, strFromU8 } from 'fflate';
import { writeFileSync } from 'node:fs';

const values = data => ({ categories: data.categories.map(({ id, label, levels }) => ({ id, label, levels })),
  series: data.series.map(({ id, name, plotKind, points }) => ({ id, name, plotKind,
    points: points.map(({ id, value, x, size }) => ({ id, value, x, size })) })) });

export async function testSharedCache({ core, edit, chart, input, assert }) {
  const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(presentation)), api = chart.createChartDataEditor(editor);
  const frames = chart.listEditableCharts(editor.doc), views = () => frames.map(frame => chart.queryChartData(editor.doc, frame.id));
  const original = views(), first = original[0], third = original[2];
  assert.deepEqual(original.map(data => data.binding.mode), ['cache', 'cache', 'cache']);
  const notices = [], recoveryFrames = [];
  editor.subscribe(change => notices.push(change)); editor.subscribeRecovery(frame => recoveryFrames.push(frame));
  api.setValue(first.chartId, first.series[0].id, first.categories[1].id, 913);
  assert.deepEqual(views().map(data => data.series[0].points[1].value), [913, 10, 913],
    '没有工作簿的同部件图表共享唯一缓存，其他图表保持独立');
  assert.ok([first.chartId, third.chartId].every(id => notices.at(-1).renderElements.has(id)),
    '共享缓存事务一次通知全部框架');
  api.setCategoryLevel(third.chartId, third.categories[0].id, 0, 'Cache North');
  assert.equal(views()[0].categories[0].levels[0], 'Cache North');
  editor.undo();
  assert.equal(views()[0].categories[0].levels[0], 'North');
  const addedCategory = api.addCategory(first.chartId, ['New group', 'New leaf']);
  assert.deepEqual(views().map(data => data.categories.length), [6, 5, 6]);
  assert.equal(views()[2].categories.at(-1).id, addedCategory, '新增记录身份不绑定到创建时的框架');
  const addedSeries = api.addSeries(third.chartId, 'Shared new series');
  api.setValue(first.chartId, addedSeries, addedCategory, 314);
  assert.equal(views()[2].series.at(-1).points.at(-1).value, 314);
  api.removeCategory(third.chartId, third.categories[0].id);
  assert.deepEqual(views()[0].categories.map(item => item.label), views()[2].categories.map(item => item.label));
  api.removeSeries(first.chartId, first.series[0].id);
  const expected = views().map(data => ({ categories: data.categories, series: data.series }));
  const saved = await editor.save(), parts = unzipSync(saved);
  writeFileSync('out/chart-shared/cache.pptx', saved);
  assert.ok(!parts['ppt/embeddings/hierarchy1.xlsx'], '纯缓存共享编辑不创建虚构工作簿');
  assert.deepEqual(parts['ppt/charts/chart2.xml'], unzipSync(input)['ppt/charts/chart2.xml'], '独立图表保留原始部件字节');
  assert.match(strFromU8(parts['ppt/slides/_rels/slide3.xml.rels']), /charts\/chart1.xml/);
  const reopened = await core.parse(saved, { edit: true, keepPackage: true, lazy: false });
  const reopenedDoc = edit.createDoc(reopened);
  assert.ok(chart.listEditableCharts(reopenedDoc).every(frame => frame.binding.mode === 'cache'),
    '新增多级类别系列保存重开后继续可编辑');
  assert.deepEqual(chart.listEditableCharts(reopenedDoc).map(frame => chart.queryChartData(reopenedDoc, frame.id))
    .filter((_, index) => index !== 1).map(values), expected.filter((_, index) => index !== 1).map(values),
  '保存重开保留共享缓存结构、数据和各框架身份');
  reopened.dispose();
  const recovering = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const restored = new edit.Editor(edit.createDoc(recovering, { idPrefix: editor.doc.identity.prefix }), { recoveryFrames });
  assert.deepEqual(chart.listEditableCharts(restored.doc).map(frame => chart.queryChartData(restored.doc, frame.id))
    .map(data => ({ categories: data.categories, series: data.series })), expected, '共享缓存结构编辑可以冷恢复');
  restored.dispose(); recovering.dispose();
  editor.undo(); editor.undo(); editor.undo(); editor.undo(); editor.undo(); editor.undo();
  assert.deepEqual(views().map(data => ({ categories: data.categories, series: data.series })),
    original.map(data => ({ categories: data.categories, series: data.series })), '整次撤销回到所有原始框架');
  editor.dispose(); presentation.dispose();
}
