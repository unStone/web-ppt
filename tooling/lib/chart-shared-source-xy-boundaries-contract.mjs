import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

export async function testSharedSourceXYBoundaries({ core, edit, chart, assert }) {
  const input = readFileSync('fixtures/sample-chart-shared-xy.pptx');
  const p = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(p)), api = chart.createChartDataEditor(editor), frames = chart.listEditableCharts(editor.doc);
  const source = chart.queryChartData(editor.doc, frames[0].id), recovery = [], notices = [];
  editor.subscribeRecovery(frame => recovery.push(frame)); editor.subscribe(change => notices.push(change));
  const id = api.addPoint(source.chartId, source.series[0].id, { x: 714, value: 715, size: 716 });
  api.removePoint(source.chartId, source.series[0].id, source.series[0].points[1].id);
  const expected = frames.map(frame => chart.queryChartData(editor.doc, frame.id));
  const book = source.binding.workbookPart, key = Object.keys(editor.doc.extensions['chart-shared'][book].xyRecords)[0];
  const prefix = ['document', 'extensions', 'chart-shared', book, 'xyRecords', key];
  const snapshot = JSON.stringify(editor.doc.extensions), count = notices.length;
  for (const [tail, value, error] of [
    [['insertions', id, 'cells', '999'], 1, /不属于记录轴/],
    [['insertions', id, 'cells', '1'], Infinity, /有界的纯数据标量/],
    [['insertions', id, 'anchor'], 1.5, /不是来源记录位置/],
    [['removed', '999'], true, /不是来源记录/],
    [['insertions', source.series[0].points[0].id, 'id'], source.series[0].points[0].id, /来源身份冲突/],
    [['insertions', id, 'bindings', 'x', 'formula'], 'Sheet1!Z1:Z5', /字段无效/],
  ]) {
    assert.throws(() => editor.applyExternalPatches([
      { op: 'set', origin: 'peer', path: [...prefix, 'insertions', id, 'cells', '1'], value: 18 },
      { op: 'set', origin: 'peer', path: [...prefix, ...tail], value },
    ]), error);
    assert.equal(JSON.stringify(editor.doc.extensions), snapshot, '非法 XY 批次不留下半次写入');
    assert.equal(notices.length, count, '回滚批次不发送渲染失效通知');
  }
  const restoredP = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const restored = new edit.Editor(edit.createDoc(restoredP, { idPrefix: editor.doc.identity.prefix }), { recoveryFrames: recovery });
  assert.deepEqual(frames.map(frame => chart.queryChartData(restored.doc, frame.id)), expected, '来源删点与新增点可从恢复日志重建');
  restored.dispose(); restoredP.dispose();
  editor.applyExternalPatches([{ op: 'set', origin: 'peer', path: [...prefix, 'insertions', 'incomplete', 'id'], value: 'incomplete' }]);
  assert.ok(chart.listEditableCharts(editor.doc).every(frame => frame.binding.mode === 'readonly'));
  await assert.rejects(editor.save(), /尚未完整/);
  editor.applyExternalPatches([{ op: 'del', origin: 'peer', path: [...prefix, 'insertions', 'incomplete', 'id'] }]);
  assert.deepEqual(frames.map(frame => chart.queryChartData(editor.doc, frame.id)), expected);
  editor.dispose(); p.dispose();

  for (const horizontal of [false, true]) {
    const bytes = readFileSync(`fixtures/sample-chart-shared-xy${horizontal ? '-horizontal' : ''}-aliased.pptx`);
    const p = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false }), editor = new edit.Editor(edit.createDoc(p));
    const api = chart.createChartDataEditor(editor), frame = chart.listEditableCharts(editor.doc)[0], before = chart.queryChartData(editor.doc, frame.id);
    assert.equal(before.binding.mode, 'workbook');
    assert.throws(() => api.addPoint(frame.id, before.series[0].id, { x: 18, value: 19, size: 20 }), /不能同时写入不同数值/);
    assert.throws(() => api.setPoint(frame.id, before.series[0].id, before.series[0].points[0].id, { x: 18, value: 19 }), /不能同时写入不同数值/);
    assert.deepEqual(chart.queryChartData(editor.doc, frame.id), before);
    const id = api.addPoint(frame.id, before.series[0].id, { x: 18, value: 18, size: 20 });
    api.setPoint(frame.id, before.series[0].id, id, { value: 19 });
    const point = chart.queryChartData(editor.doc, frame.id).series[0].points.at(-1);
    assert.equal(point.x, 19, '同一物理格承载两个维度时只有一份数值');
    await editor.save(); editor.dispose(); p.dispose();
  }
  {
    const bytes = readFileSync('fixtures/sample-chart-shared-xy-crossed.pptx');
    const p = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false }), editor = new edit.Editor(edit.createDoc(p));
    const api = chart.createChartDataEditor(editor), frame = chart.listEditableCharts(editor.doc)[0], original = chart.queryChartData(editor.doc, frame.id);
    for (let index = 0; index < 2; index++) api.addPoint(frame.id, original.series[0].id, { x: 11, value: 12, size: 13 });
    api.addPoint(frame.id, original.series[1].id, { x: 21, value: 22, size: 23 });
    const snapshot = JSON.stringify(editor.doc.extensions);
    assert.throws(() => api.addPoint(frame.id, original.series[1].id, { x: 31, value: 32, size: 33 }), /记录扩展区域.*重叠/,
      '两个原本不相交的记录轴不能扩展到同一个空格');
    assert.equal(JSON.stringify(editor.doc.extensions), snapshot);
    await editor.save(); editor.dispose(); p.dispose();
  }
  for (const horizontal of [false, true]) {
    const bytes = readFileSync(`fixtures/sample-chart-shared-xy${horizontal ? '-horizontal' : ''}-blocked.pptx`);
    const p = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false }), editor = new edit.Editor(edit.createDoc(p));
    const api = chart.createChartDataEditor(editor), frame = chart.listEditableCharts(editor.doc)[0], before = chart.queryChartData(editor.doc, frame.id);
    assert.throws(() => api.addPoint(frame.id, before.series[0].id, { x: 18, value: null, size: null }), horizontal ? /F1.*被其他内容占用/ : /A6.*被其他内容占用/);
    assert.deepEqual(chart.queryChartData(editor.doc, frame.id), before);
    assert.equal(editor.doc.extensions, undefined);
    assert.deepEqual(unzipSync(await editor.save())['ppt/embeddings/hierarchy1.xlsx'], unzipSync(bytes)['ppt/embeddings/hierarchy1.xlsx']);
    editor.dispose(); p.dispose();
  }
  for (const horizontal of [false, true]) for (const cleared of [false, true]) {
    const bytes = readFileSync(`fixtures/sample-chart-shared-xy${horizontal ? '-horizontal' : ''}${cleared ? '' : '-empty'}.pptx`);
    const p = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false }), editor = new edit.Editor(edit.createDoc(p));
    const api = chart.createChartDataEditor(editor), frame = chart.listEditableCharts(editor.doc)[0], original = chart.queryChartData(editor.doc, frame.id);
    if (cleared) for (const series of original.series) for (const point of series.points) api.removePoint(frame.id, series.id, point.id);
    assert.ok(chart.queryChartData(editor.doc, frame.id).series.every(series => series.points.length === 0), '空缓存不应生成一个虚构空点');
    const blank = await core.parse(await editor.save(), { edit: true, keepPackage: true, lazy: false }), blankDoc = edit.createDoc(blank);
    assert.ok(chart.listEditableCharts(blankDoc).every(frame => chart.queryChartData(blankDoc, frame.id).series.every(series => series.points.length === 0)),
      '删空来源点保存重开仍为空，不生成占位数据');
    edit.disposeDoc(blankDoc); blank.dispose();
    const added = api.addSeries(frame.id, 'After empty');
    api.addPoint(frame.id, added, { x: 1, value: 2, size: 3 });
    api.addPoint(frame.id, added, { x: 4, value: 5, size: 6 });
    const state = chart.queryChartData(editor.doc, frame.id), binding = state.series.find(series => series.id === added).bindings.x.formula;
    assert.match(binding, horizontal ? /!\$[A-Z]+\$(\d+):\$[A-Z]+\$\1$/ : /!\$([A-Z]+)\$\d+:\$\1\$\d+$/,
      '新增系列继承空 XY 的记录方向');
    const saved = await editor.save(), reopened = await core.parse(saved, { edit: true, keepPackage: true, lazy: false });
    const next = new edit.Editor(edit.createDoc(reopened)), nextApi = chart.createChartDataEditor(next), target = chart.listEditableCharts(next.doc)[0];
    const before = chart.queryChartData(next.doc, target.id);
    const inserted = nextApi.addPoint(target.id, before.series[0].id, { x: 71, value: 72, size: 73 });
    const after = chart.queryChartData(next.doc, target.id);
    assert.equal(after.series[0].points[0].id, inserted);
    assert.deepEqual(after.series.find(series => series.id === added), before.series.find(series => series.id === added),
      '空系列预留来源范围，不与其他新增系列建立意外共享');
    await next.save(); next.dispose(); reopened.dispose(); editor.dispose(); p.dispose();
  }
}
