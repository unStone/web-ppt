import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

const summary = data => data.series.map(({ id, name, points }) => ({ id, name,
  points: points.map(({ id, x, value, size }) => ({ id, x, value, size })) }));
const unchanged = series => series.map(({ name, points }) => ({ name, points: points.map(({ x, value, size }) => ({ x, value, size })) }));

export async function testSharedSourceXYViews({ core, edit, chart, assert }) {
  for (const horizontal of [false, true]) for (const variant of ['views', 'shared-x', 'sheets', 'empty']) for (const released of [false, true]) {
    const stem = `xy${horizontal ? '-horizontal' : ''}-${variant}`;
    const input = readFileSync(`fixtures/sample-chart-shared-${stem}.pptx`);
    const p = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const editor = new edit.Editor(edit.createDoc(p)), api = chart.createChartDataEditor(editor);
    const frames = chart.listEditableCharts(editor.doc), views = () => frames.map(frame => chart.queryChartData(editor.doc, frame.id));
    const original = views(), target = original[variant === 'views' ? 1 : 0];
    assert.ok(original.every(data => data.binding.mode === 'workbook'), `${stem} 来源可写`);
    const id = api.addPoint(target.chartId, target.series[0].id, { x: 61, value: 71, size: 81 });
    let commands = 1;
    if (variant === 'views') {
      assert.deepEqual(views()[0].series[0].points.map(point => point.id),
        [...original[0].series[0].points.slice(0, 3).map(point => point.id), id, original[0].series[0].points[3].id],
        '部分视图末尾插点在完整视图中位于原范围中间');
      api.removePoint(target.chartId, target.series[0].id, target.series[0].points[1].id);
      api.setValue(original[2].chartId, original[2].series[0].id, original[2].series[0].points[3].id, 515);
      commands += 2;
      assert.equal(views()[0].series[0].points.at(-1).value, 515);
      assert.equal(views()[1].series[0].points.at(-1).id, id, '删掉插入锚点仍保留新点');
    } else if (variant === 'shared-x') {
      assert.ok(views().every(data => data.series.every(series => series.points.at(-1).id === id)), '只共享 X 轴也共享记录身份');
      assert.deepEqual(views()[0].series[1].points.at(-1), { id, order: views()[0].series[1].points.at(-1).order, x: 61, value: null, size: null });
      api.setPoint(original[1].chartId, original[1].series[1].id, id, { x: 62, value: 72, size: 82 });
      api.removePoint(target.chartId, target.series[0].id, target.series[0].points[0].id); commands += 2;
      assert.ok(views().every(data => data.series.every(series => series.points.length === 4 && series.points.at(-1).x === 62)));
      assert.ok(views().every(data => data.series[0].points.at(-1).value === 71 && data.series[1].points.at(-1).value === 72));
    } else if (variant === 'sheets') {
      assert.deepEqual(views()[1], original[1], '其他工作表的 XY 视图保持独立');
    } else {
      api.removePoint(target.chartId, target.series[0].id, id); commands++;
      assert.ok(views().every(data => data.series.every(series => series.points.length === 0)));
      api.addPoint(target.chartId, target.series[0].id, { x: 91, value: 92, size: 93 }); commands++;
      assert.ok(views().every(data => data.series[0].points.length === 1), '原本空系列可添加、清空后再次添加');
    }
    const expected = views().map(summary);
    if (released) p.dispose();
    const bytes = await editor.save(), reopened = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false }), doc = edit.createDoc(reopened);
    const actual = chart.listEditableCharts(doc).map(frame => chart.queryChartData(doc, frame.id));
    assert.ok(actual.every(data => data.binding.mode === 'workbook'), `${stem} 保存重开可写`);
    const comparable = list => list.map((series, index) => variant === 'sheets' && index === 1 ? unchanged(series) : series);
    assert.deepEqual(comparable(actual.map(summary)), comparable(expected), `${stem} 重开保持范围与已编辑点身份`);
    if (variant === 'sheets') assert.deepEqual(unzipSync(bytes)['ppt/charts/chart2.xml'], unzipSync(input)['ppt/charts/chart2.xml'],
      '未改动图表部件逐字节保留，不为新会话注入身份扩展');
    if (variant === 'sheets') assert.deepEqual(unzipSync(unzipSync(bytes)['ppt/embeddings/hierarchy1.xlsx'])['xl/worksheets/sheet3.xml'],
      unzipSync(unzipSync(input)['ppt/embeddings/hierarchy1.xlsx'])['xl/worksheets/sheet3.xml']);
    writeFileSync(`out/chart-shared/source-${stem}-${released ? 'generated' : 'patched'}.pptx`, bytes);
    edit.disposeDoc(doc); reopened.dispose();
    while (commands--) editor.undo();
    assert.deepEqual(views(), original);
    assert.deepEqual(unzipSync(await editor.save())['ppt/embeddings/hierarchy1.xlsx'], unzipSync(input)['ppt/embeddings/hierarchy1.xlsx']);
    editor.dispose(); p.dispose();
  }
}
