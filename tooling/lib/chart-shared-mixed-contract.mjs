import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

const summary = data => ({ kind: data.kind, categories: data.categories.map(({ id, label, levels }) => ({ id, label, levels })),
  series: data.series.map(({ id, name, points }) => ({ id, name,
    points: points.map(({ id, x, value, size }) => ({ id, x, value, size })) })) });

export async function testSharedMixed({ core, edit, chart, assert }) {
  for (const name of ['mixed', 'mixed-horizontal', 'mixed-crossed']) for (const released of [false, true]) {
    const input = readFileSync(`fixtures/sample-chart-shared-${name}.pptx`);
    const p = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const editor = new edit.Editor(edit.createDoc(p)), api = chart.createChartDataEditor(editor);
    const frames = chart.listEditableCharts(editor.doc), views = () => frames.map(frame => chart.queryChartData(editor.doc, frame.id));
    const original = views(), first = original[0], third = original[2], recoveryFrames = [], changes = [];
    editor.subscribeRecovery(frame => recoveryFrames.push(frame)); editor.subscribe(change => changes.push(change));
    assert.ok(original.every(data => data.kind === 'mixed' && data.binding.mode === 'workbook'));
    const category = api.addCategory(first.chartId, 'Mixed category');
    assert.ok(views().every(data => data.categories.at(-1).id === category), '混合图独立类别区域允许新增并同步各框架');
    assert.deepEqual(views().map(data => data.series[2]), original.map(data => data.series[2]), '类别增删不能扩展不相交的 XY 公式或数据点');
    assert.ok(frames.every(frame => changes.at(-1).renderElements.has(frame.id)));
    api.setValue(third.chartId, third.series[0].id, category, 617);
    api.removeCategory(first.chartId, first.categories[0].id);
    const categoryState = views().map(data => ({ categories: data.categories, series: data.series.slice(0, 2) }));
    const point = api.addPoint(first.chartId, first.series[2].id, { x: 71, value: 72, size: 73 });
    api.setPoint(third.chartId, third.series[2].id, point, { x: 81, value: 82, size: 83 });
    api.removePoint(first.chartId, first.series[2].id, first.series[2].points[0].id);
    assert.deepEqual(views().map(data => ({ categories: data.categories, series: data.series.slice(0, 2) })), categoryState,
      'XY 点增删不能改变同部件中的独立类别区域');
    assert.ok(views().every(data => data.series[2].points.at(-1).x === 81 && data.series[0].points.at(-1).value === 617));
    const expected = views().map(summary);
    const recovering = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const recovered = new edit.Editor(edit.createDoc(recovering, { idPrefix: editor.doc.identity.prefix }), { recoveryFrames });
    assert.deepEqual(chart.listEditableCharts(recovered.doc).map(frame => summary(chart.queryChartData(recovered.doc, frame.id))), expected);
    recovered.dispose(); recovering.dispose();
    if (released) p.dispose();
    const bytes = await editor.save(), reopened = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
    const doc = edit.createDoc(reopened);
    assert.deepEqual(chart.listEditableCharts(doc).map(frame => summary(chart.queryChartData(doc, frame.id))), expected,
      '混合图独立记录轴经两条保存路径重开保持身份、类别与 XY 数据');
    writeFileSync(`out/chart-shared/${name}-${released ? 'generated' : 'patched'}.pptx`, bytes);
    edit.disposeDoc(doc); reopened.dispose();
    for (let i = 0; i < 6; i++) editor.undo();
    assert.deepEqual(views(), original);
    assert.deepEqual(unzipSync(await editor.save())['ppt/embeddings/hierarchy1.xlsx'], unzipSync(input)['ppt/embeddings/hierarchy1.xlsx']);
    editor.dispose(); p.dispose();
  }
  const p = await core.parse(readFileSync('fixtures/sample-chart-shared-mixed-overlap-crossed.pptx'), { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(p)), api = chart.createChartDataEditor(editor), frames = chart.listEditableCharts(editor.doc);
  const first = chart.queryChartData(editor.doc, frames[0].id);
  api.setPoint(first.chartId, first.series[2].id, first.series[2].points[0].id, { x: 733 });
  assert.ok(frames.every(frame => {
    const data = chart.queryChartData(editor.doc, frame.id);
    return data.series[0].points[0].value === 733 && data.series[2].points[0].x === 733;
  }), '混合记录轴交叠时标量仍按同一单元格联动');
  for (const action of [
    () => api.addCategory(first.chartId, 'ambiguous'), () => api.removeCategory(first.chartId, first.categories[0].id),
    () => api.addPoint(first.chartId, first.series[2].id, { x: 1, value: 2, size: 3 }),
    () => api.removePoint(first.chartId, first.series[2].id, first.series[2].points[0].id),
  ]) {
    const before = JSON.stringify({ ...editor.doc, identity: undefined }), identity = structuredClone(editor.doc.identity);
    const count = editor.history.undoCount;
    assert.throws(action, /XY|重叠|类别/, '交叠的类别与 XY 记录缺少共同增删语义时明确拒绝');
    const next = editor.doc.identity;
    assert.equal(JSON.stringify({ ...editor.doc, identity: undefined }), before); assert.equal(editor.history.undoCount, count);
    // 新增入口预先分配的身份不得回收；失败仍需保证语义、资源与历史不变。
    assert.deepEqual(next, { ...identity, nextElement: next.nextElement });
    assert.ok(next.nextElement >= identity.nextElement && next.nextElement <= identity.nextElement + 1);
  }
  editor.dispose(); p.dispose();
}
