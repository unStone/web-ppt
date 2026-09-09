import { readFileSync } from 'node:fs';

export async function testSharedSinglePart({ core, edit, chart, assert }) {
  for (const released of [false, true]) {
    const presentation = await core.parse(readFileSync('fixtures/sample-chart-shared-xy-single-part.pptx'),
      { edit: true, keepPackage: true, lazy: false });
    const editor = new edit.Editor(edit.createDoc(presentation)), api = chart.createChartDataEditor(editor);
    const views = (doc = editor.doc) => chart.listEditableCharts(doc).map(frame => chart.queryChartData(doc, frame.id));
    const first = views()[0];
    assert.deepEqual(views().map(data => data.binding.mode), ['workbook', 'workbook', 'workbook'],
      '单个图表部件内部共用 X 区域时继续使用单元格所有权');
    const point = api.addPoint(first.chartId, first.series[0].id, { x: 17, value: 71, size: 7 });
    assert.deepEqual(views().map(data => data.series.map(series => series.points.at(-1).x)),
      [[17, 17], [17, 17], [17, 17]]);
    assert.ok(editor.doc.extensions['chart-shared'][first.binding.workbookPart]);
    assert.equal(editor.doc.extensions['chart-shared'][first.binding.chartPart], undefined,
      '数值别名不能切换到独占区域的数据集写回');
    const second = views()[1];
    api.setValue(second.chartId, second.series[1].id, point, 72);
    editor.undo(); editor.redo();
    const summary = data => data.series.map(series => series.points.map(({ value, x, size }) => ({ value, x, size })));
    const expected = views().map(summary);
    if (released) presentation.dispose();
    const reopened = await core.parse(await editor.save(), { edit: true, keepPackage: true, lazy: false });
    const doc = edit.createDoc(reopened);
    assert.deepEqual(views(doc).map(summary), expected, '单部件共享 X 的新增点、独立 Y 与大小保存重开一致');
    assert.ok(views(doc).every(data => data.binding.mode === 'workbook'));
    edit.disposeDoc(doc); reopened.dispose(); editor.dispose(); presentation.dispose();
  }
}
