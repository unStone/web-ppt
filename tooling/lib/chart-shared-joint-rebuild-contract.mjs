import { readFileSync, writeFileSync } from 'node:fs';

export async function testSharedJointRebuild({ core, edit, chart, assert }) {
  for (const name of ['mixed-records', 'mixed-records-horizontal', 'mixed-records-flat-horizontal']) for (const released of [false, true]) for (const xy of [false, true]) {
    const source = await core.parse(readFileSync(`fixtures/sample-chart-shared-${name}.pptx`), { edit: true, keepPackage: true, lazy: false });
    const editor = new edit.Editor(edit.createDoc(source)), api = chart.createChartDataEditor(editor);
    const initial = chart.queryChartData(editor.doc, chart.listEditableCharts(editor.doc)[0].id);
    for (const record of xy ? initial.series[2].points : initial.categories) {
      if (xy) api.removePoint(initial.chartId, initial.series[2].id, record.id);
      else api.removeCategory(initial.chartId, record.id);
    }
    if (released) source.dispose();
    const empty = await editor.save(); editor.dispose(); source.dispose();
    const reopened = await core.parse(empty, { edit: true, keepPackage: true, lazy: false });
    const restored = new edit.Editor(edit.createDoc(reopened)), restoredApi = chart.createChartDataEditor(restored);
    const views = () => chart.listEditableCharts(restored.doc).map(frame => chart.queryChartData(restored.doc, frame.id));
    assert.ok(views().every(view => view.binding.mode === 'workbook' && view.categories.length === 0 && view.series[2].points.length === 0));
    const first = views()[0], last = views()[2];
    const id = xy ? restoredApi.addPoint(first.chartId, first.series[2].id, { x: 7, value: 8, size: 9 })
      : restoredApi.addCategory(first.chartId, name.includes('flat') ? 'Rebuilt category' : ['Rebuilt group', 'Rebuilt category']);
    assert.ok(views().every(view => view.categories.length === 1 && view.series[2].points.length === 1
      && view.categories[0].id === id && view.series[2].points[0].id === id), '空保存重开后的两个入口仍共用一个来源记录轴');
    restoredApi.setValue(last.chartId, last.series[0].id, id, 717);
    restoredApi.setPoint(last.chartId, last.series[2].id, id, { value: 718, size: 719 });
    assert.equal(Object.values(restored.doc.extensions['chart-shared'])[0].xyRecords, undefined);
    if (released) reopened.dispose();
    const saved = await restored.save();
    if (!xy) writeFileSync(`out/chart-shared/${name}-rebuilt-${released ? 'generated' : 'patched'}.pptx`, saved);
    const again = await core.parse(saved, { edit: true, keepPackage: true, lazy: false }), doc = edit.createDoc(again);
    assert.ok(chart.listEditableCharts(doc).every(frame => {
      const view = chart.queryChartData(doc, frame.id);
      return view.categories.length === 1 && view.series[0].points[0].value === 717
        && view.series[2].points[0].x === 717 && view.series[2].points[0].value === 718 && view.series[2].points[0].size === 719;
    }));
    edit.disposeDoc(doc); again.dispose();
    restored.undo(); restored.undo(); restored.undo();
    assert.ok(views().every(view => view.categories.length === 0 && view.series[2].points.length === 0));
    restored.dispose(); reopened.dispose();
  }
}
