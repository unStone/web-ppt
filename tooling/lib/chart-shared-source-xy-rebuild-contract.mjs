import { readFileSync, writeFileSync } from 'node:fs';

export async function testSharedSourceXYRebuild({ core, edit, chart, assert }) {
  for (const horizontal of [false, true]) for (const cleared of [false, true]) for (const released of [false, true]) {
    const fixture = `sample-chart-shared-xy${horizontal ? '-horizontal' : ''}.pptx`;
    const p = await core.parse(readFileSync(`fixtures/${fixture}`), { edit: true, keepPackage: true, lazy: false });
    const editor = new edit.Editor(edit.createDoc(p)), api = chart.createChartDataEditor(editor), frames = chart.listEditableCharts(editor.doc);
    const original = chart.queryChartData(editor.doc, frames[0].id);
    for (const series of original.series) {
      if (cleared) for (const point of series.points) api.removePoint(original.chartId, series.id, point.id);
      api.removeSeries(original.chartId, series.id);
    }
    if (released) p.dispose();
    const blank = await core.parse(await editor.save(), { edit: true, keepPackage: true, lazy: false });
    const next = new edit.Editor(edit.createDoc(blank)), editNext = chart.createChartDataEditor(next), nextFrames = chart.listEditableCharts(next.doc);
    const views = () => nextFrames.map(frame => chart.queryChartData(next.doc, frame.id));
    assert.equal(views()[0].series.length, 0);
    const series = editNext.addSeries(nextFrames[0].id, 'Rebuilt XY');
    const first = editNext.addPoint(nextFrames[0].id, series, { x: 131, value: 132, size: 133 });
    editNext.addPoint(nextFrames[2].id, series, { x: 431, value: 432, size: 433 });
    assert.ok([views()[0], views()[2]].every(data => data.series[0].points[0].id === first));
    const before = views().map(data => data.series.map(({ id, name, points }) => ({ id, name, points: points.map(({ id, x, value, size }) => ({ id, x, value, size })) })));
    if (released) blank.dispose();
    const bytes = await next.save(), reopened = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false }), doc = edit.createDoc(reopened);
    const actual = chart.listEditableCharts(doc).map(frame => chart.queryChartData(doc, frame.id));
    assert.ok(actual.every(data => data.binding.mode === 'workbook'));
    for (const index of [0, 2]) assert.deepEqual(actual[index].series.map(({ id, name, points }) => ({ id, name, points: points.map(({ id, x, value, size }) => ({ id, x, value, size })) })), before[index]);
    const binding = actual[0].series[0].bindings.x.formula;
    assert.match(binding, horizontal ? /!\$[A-Z]+\$(\d+):\$[A-Z]+\$\1$/ : /!\$([A-Z]+)\$\d+:\$\1\$\d+$/);
    next.undo(); next.undo(); next.undo();
    assert.equal(views()[0].series.length, 0, '保存后可撤销重建，回到可继续使用的原模板');
    if (!cleared) writeFileSync(`out/chart-shared/source-xy-rebuilt${horizontal ? '-horizontal' : ''}-${released ? 'generated' : 'patched'}.pptx`, bytes);
    edit.disposeDoc(doc); reopened.dispose(); next.dispose(); blank.dispose(); editor.dispose(); p.dispose();
  }
}
