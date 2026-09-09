import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

export async function testSharedCategoryGrowthBoundaries({ core, edit, chart, assert }) {
  const input = readFileSync('fixtures/sample-chart-shared.pptx');
  const p = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(p)), api = chart.createChartDataEditor(editor), frames = chart.listEditableCharts(editor.doc);
  const source = chart.queryChartData(editor.doc, frames[0].id), recovery = [];
  editor.subscribeRecovery(frame => recovery.push(frame));
  const row = api.addCategory(source.chartId, ['Recovered', 'New leaf']);
  api.setValue(source.chartId, source.series[0].id, row, 714);
  const snapshot = JSON.stringify(editor.doc.extensions);
  const book = source.binding.workbookPart, key = Object.keys(editor.doc.extensions['chart-shared'][book].insertions)[0];
  const prefix = ['document', 'extensions', 'chart-shared', book, 'insertions', key];
  const path = [...prefix, row, 'cells', '3'];
  assert.throws(() => editor.applyExternalPatches([
    { op: 'set', origin: 'peer', path, value: 18 },
    { op: 'set', origin: 'peer', path: [...prefix, row, 'cells', '999'], value: 19 },
  ]), /不属于记录轴/);
  assert.equal(JSON.stringify(editor.doc.extensions), snapshot, '扩展区校验失败不留下部分单元格修改');
  assert.throws(() => editor.applyExternalPatches([{ op: 'set', origin: 'peer', path: [...prefix, source.series[0].id, 'id'], value: source.series[0].id }]), /来源身份冲突/);
  const restoredP = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const restored = new edit.Editor(edit.createDoc(restoredP, { idPrefix: editor.doc.identity.prefix }), { recoveryFrames: recovery });
  assert.ok(chart.listEditableCharts(restored.doc).every(frame => chart.queryChartData(restored.doc, frame.id).series[0].points.at(-1).value === 714));
  restored.dispose(); restoredP.dispose();
  editor.applyExternalPatches([{ op: 'set', origin: 'peer', path: [...prefix, row, 'parent'], value: row }]);
  assert.ok(chart.listEditableCharts(editor.doc).every(frame => frame.binding.mode === 'readonly'), '循环父引用不能生成可写投影');
  await assert.rejects(editor.save(), /父级引用/);
  editor.applyExternalPatches([{ op: 'set', origin: 'peer', path: [...prefix, row, 'parent'], value: null }]);
  assert.ok(chart.listEditableCharts(editor.doc).every(frame => frame.binding.mode === 'workbook'));
  editor.dispose(); p.dispose();

  const blockedInput = readFileSync('fixtures/sample-chart-shared-row-blocked.pptx');
  const blocked = await core.parse(blockedInput, { edit: true, keepPackage: true, lazy: false });
  const failed = new edit.Editor(edit.createDoc(blocked)), failedApi = chart.createChartDataEditor(failed);
  const target = chart.listEditableCharts(failed.doc)[0], before = chart.queryChartData(failed.doc, target.id);
  assert.throws(() => failedApi.addCategory(target.id, 'Would overwrite'), /D7.*被其他内容占用/);
  assert.deepEqual(chart.queryChartData(failed.doc, target.id), before, '目标行被占用时原子拒绝类别新增');
  assert.equal(failed.doc.extensions, undefined);
  assert.deepEqual(unzipSync(await failed.save())['ppt/embeddings/hierarchy1.xlsx'], unzipSync(blockedInput)['ppt/embeddings/hierarchy1.xlsx']);
  failed.dispose(); blocked.dispose();
}
