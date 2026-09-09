export async function testSharedCacheXY({ core, edit, chart, input, assert }) {
  const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(presentation)), api = chart.createChartDataEditor(editor);
  const frames = chart.listEditableCharts(editor.doc).filter(frame => frame.binding.chartPart === 'ppt/charts/chart1.xml');
  const views = () => frames.map(frame => chart.queryChartData(editor.doc, frame.id));
  const [first, second] = views();
  api.setPoint(second.chartId, second.series[0].id, second.series[0].points[0].id, { value: 51, x: 52, size: 53 });
  assert.deepEqual(views().map(data => data.series[0].points[0]).map(({ value, x, size }) => ({ value, x, size })),
    [{ value: 51, x: 52, size: 53 }, { value: 51, x: 52, size: 53 }]);
  const point = api.addPoint(first.chartId, first.series[0].id, { value: 61, x: 62, size: 63 });
  assert.equal(views()[1].series[0].points.at(-1).id, point);
  api.removePoint(second.chartId, second.series[0].id, second.series[0].points[1].id);
  const series = api.addSeries(second.chartId, 'New bubble');
  api.addPoint(first.chartId, series, { value: 71, x: 72, size: 73 });
  const values = data => data.series.map(series => ({ id: series.id, name: series.name,
    points: series.points.map(({ id, value, x, size }) => ({ id, value, x, size })) }));
  const expected = views().map(values), saved = await editor.save();
  const reopened = await core.parse(saved, { edit: true, keepPackage: true, lazy: false }), doc = edit.createDoc(reopened);
  assert.deepEqual(chart.listEditableCharts(doc).filter(frame => frame.binding.chartPart === 'ppt/charts/chart1.xml')
    .map(frame => values(chart.queryChartData(doc, frame.id))), expected, '共享 XY 点的三维值、结构和稳定身份保存后保留');
  reopened.dispose();
  editor.undo(); editor.undo(); editor.undo(); editor.undo(); editor.undo();
  assert.deepEqual(views().map(values), [first, second].map(values), '共享 XY 结构可整次撤销');
  editor.dispose(); presentation.dispose();
}
