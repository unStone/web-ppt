import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

const summary = data => data.series.map(({ id, name, points }) => ({ id, name,
  points: points.map(({ id, x, value, size }) => ({ id, x, value, size })) }));

export async function testSharedSourceXY({ core, edit, chart, assert }) {
  for (const horizontal of [false, true]) for (const released of [false, true]) {
    const input = readFileSync(`fixtures/sample-chart-shared-xy${horizontal ? '-horizontal' : ''}.pptx`);
    const p = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const editor = new edit.Editor(edit.createDoc(p)), api = chart.createChartDataEditor(editor);
    const frames = chart.listEditableCharts(editor.doc), views = () => frames.map(frame => chart.queryChartData(editor.doc, frame.id));
    const original = views(), first = original[0], third = original[2], notices = [];
    editor.subscribe(change => notices.push(change));
    const point = api.addPoint(first.chartId, first.series[0].id, { x: 111, value: 222, size: 333 });
    assert.ok(views().every(data => data.series[0].points.at(-1).id === point), '原有 XY 系列按区域共享新增点身份');
    assert.ok(frames.every(frame => notices.at(-1).renderElements.has(frame.id)), '一次点新增同步失效全部关联框架');
    assert.deepEqual(views().map(data => data.series[1]), original.map(data => data.series[1]), '不相交的 XY 系列保持独立');
    api.setPoint(third.chartId, third.series[0].id, point, { x: 112, value: 223, size: 334 });
    api.removePoint(original[1].chartId, original[1].series[0].id, original[1].series[0].points[0].id);
    const second = api.addPoint(first.chartId, first.series[0].id, { x: 431, value: 432, size: 433 });
    api.setValue(third.chartId, third.series[0].id, third.series[0].points[1].id, 515);
    api.removePoint(first.chartId, first.series[0].id, point);
    assert.ok(views().every(data => data.series[0].points.at(-1).id === second));
    assert.ok(views().every(data => data.series[0].points[0].value === 515), '删点后来源身份仍指向原记录');
    const expected = views().map(summary);
    if (released) p.dispose();
    const saved = await editor.save(), reopened = await core.parse(saved, { edit: true, keepPackage: true, lazy: false });
    const doc = edit.createDoc(reopened), actual = chart.listEditableCharts(doc).map(frame => chart.queryChartData(doc, frame.id));
    assert.ok(actual.every(data => data.binding.mode === 'workbook'));
    assert.deepEqual(actual.map(summary), expected, '原有 XY 点增删与三维数值保存重开保持');
    writeFileSync(`out/chart-shared/source-xy${horizontal ? '-horizontal' : ''}-${released ? 'generated' : 'patched'}.pptx`, saved);
    edit.disposeDoc(doc); reopened.dispose();
    for (let index = 0; index < 6; index++) editor.undo();
    assert.deepEqual(views(), original);
    assert.deepEqual(unzipSync(await editor.save())['ppt/embeddings/hierarchy1.xlsx'], unzipSync(input)['ppt/embeddings/hierarchy1.xlsx']);
    editor.dispose(); p.dispose();
  }
}
