import { readFileSync } from 'node:fs';

export async function testSharedGrowthBoundaries({ core, edit, chart, assert }) {
  const input = readFileSync('fixtures/sample-chart-shared.pptx');
  const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(presentation)), frames = chart.listEditableCharts(editor.doc);
  const api = chart.createChartDataEditor(editor), recovery = [];
  editor.subscribeRecovery(frame => recovery.push(frame));
  const id = api.addSeries(frames[0].id, 'Recovered series');
  const value = chart.queryChartData(editor.doc, frames[0].id);
  api.setValue(frames[0].id, id, value.categories[1].id, 19);
  const restoredPresentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const restored = new edit.Editor(edit.createDoc(restoredPresentation, { idPrefix: editor.doc.identity.prefix }), { recoveryFrames: recovery });
  assert.deepEqual(chart.queryChartData(restored.doc, frames[2].id).series.at(-1).points.map(point => point.value), [null, 19, null, null, null],
    '文档级新增系列和后续修改可从恢复日志重新物化');
  restored.dispose(); restoredPresentation.dispose();
  const part = value.binding.chartPart, book = value.binding.workbookPart;
  const path = ['document', 'extensions', 'chart-shared', book, 'addedSeries', part, `n:${id}`, 'name'];
  const before = JSON.stringify(editor.doc.extensions);
  assert.throws(() => editor.applyExternalPatches([
    { op: 'set', origin: 'peer', path, value: 'Should roll back' },
    { op: 'set', origin: 'peer', path: [...path.slice(0, -1), 'bindings', 'values', 'formula'], value: 'Sheet1!A1' },
  ]), /不能注入来源公式/);
  assert.equal(JSON.stringify(editor.doc.extensions), before, '新增系列混合批次失败原子回滚');
  assert.throws(() => editor.applyExternalPatches([{ op: 'set', origin: 'peer', path: [...path.slice(0, 6), 's0', 'name'], value: 'bad' }]), /路径或身份/);
  editor.applyExternalPatches([{ op: 'set', origin: 'peer', path: [...path.slice(0, 6), 'n:incomplete', 'name'], value: 'Partial arrival' }]);
  assert.ok(chart.listEditableCharts(editor.doc).every(frame => frame.binding.mode === 'readonly'),
    '共享工作簿里的不完整新增记录不能当作完整可保存数据');
  await assert.rejects(editor.save(), /尚未完整|数据约束/);
  editor.applyExternalPatches([{ op: 'del', origin: 'peer', path: [...path.slice(0, 6), 'n:incomplete', 'name'] }]);
  assert.ok(chart.listEditableCharts(editor.doc).every(frame => frame.binding.mode === 'workbook'), '撤回不完整记录后恢复原数据');
  editor.dispose(); presentation.dispose();
}
