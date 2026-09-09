import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

export async function testSharedXYGrowth({ core, edit, chart, assert }) {
  for (const horizontal of [false, true]) for (const released of [false, true]) {
    const input = readFileSync(`fixtures/sample-chart-shared-xy${horizontal ? '-horizontal' : ''}.pptx`);
    const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const editor = new edit.Editor(edit.createDoc(presentation)), api = chart.createChartDataEditor(editor);
    const frames = chart.listEditableCharts(editor.doc), views = () => frames.map(frame => chart.queryChartData(editor.doc, frame.id));
    const original = views(), [first, , third] = original;
    assert.ok(original.every(data => data.binding.mode === 'workbook'), '共享 XY 固件含可编辑的原生数据绑定');
    const series = api.addSeries(first.chartId, 'Shared bubble');
    const point = api.addPoint(third.chartId, series, { value: 10, x: 11, size: 12 });
    api.addPoint(first.chartId, series, { value: 20, x: 21, size: 22 });
    api.setPoint(first.chartId, series, point, { value: 30, x: 31, size: 32 });
    api.removePoint(third.chartId, series, point);
    const second = api.addSeries(frames[1].id, 'Another view');
    api.addPoint(frames[1].id, second, { value: 40, x: 41, size: 42 });
    assert.deepEqual(views().map(data => data.series.length), [3, 3, 3]);
    const summary = data => data.series.map(series => ({ id: series.id, name: series.name,
      points: series.points.map(({ id, value, x, size }) => ({ id, value, x, size })) }));
    const expected = views().map(summary);
    const formulas = views().slice(0, 2).flatMap(data => data.series.at(-1)).flatMap(series => ['x', 'y', 'size'].map(field => series.bindings[field].formula));
    assert.equal(new Set(formulas).size, 6, '不同共享图表新 XY 系列的三个维度分配到独立区域');
    if (released) presentation.dispose();
    const saved = await editor.save(), reopened = await core.parse(saved, { edit: true, keepPackage: true, lazy: false }), doc = edit.createDoc(reopened);
    writeFileSync(`out/chart-shared/growth-xy${horizontal ? '-horizontal' : ''}-${released ? 'generated' : 'patched'}.pptx`, saved);
    const actual = chart.listEditableCharts(doc).map(frame => chart.queryChartData(doc, frame.id));
    assert.ok(actual.every(data => data.binding.mode === 'workbook'));
    assert.deepEqual(actual.map(summary), expected, '共享新增 XY 系列的点值、删除和身份保存重开保持一致');
    edit.disposeDoc(doc); reopened.dispose();
    for (let i = 0; i < 7; i++) editor.undo();
    assert.deepEqual(views(), original);
    assert.deepEqual(unzipSync(await editor.save())['ppt/embeddings/hierarchy1.xlsx'], unzipSync(input)['ppt/embeddings/hierarchy1.xlsx']);
    editor.dispose(); presentation.dispose();
  }
}
