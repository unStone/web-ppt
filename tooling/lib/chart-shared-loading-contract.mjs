import { prepareSharedLegacyLoading } from './chart-shared-legacy-loading-contract.mjs';

export async function testSharedLoading({ core, edit, chart, basicChart, input, assert }) {
  const verifyLegacy = await prepareSharedLegacyLoading({ core, edit, basicChart, assert });
  const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(presentation));
  const frames = basicChart.listEditableCharts(editor.doc);
  assert.ok(frames.every(frame => frame.binding.mode === 'readonly'), '普通图表入口未加载共享实现时明确只读');
  const hiddenSource = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const hidden = new edit.Editor(edit.createDoc(hiddenSource));
  const hiddenFrames = basicChart.listEditableCharts(hidden.doc);
  hiddenFrames.slice(1).forEach(frame => hidden.exec({ type: 'RemoveElement', id: frame.id }));
  assert.equal(basicChart.queryChartData(hidden.doc, hiddenFrames[0].id).binding.mode, 'readonly',
    '共享扩展未加载时，原生部件中的未挂载消费者仍使编辑保持只读');
  hidden.dispose(); hiddenSource.dispose();
  const original = frames.map(frame => JSON.stringify(editor.effectiveElement(frame.id)));
  editor.applyExternalPatches([{ op: 'set', origin: 'recovery',
    path: ['document', 'extensions', 'chart-shared', 'ppt/embeddings/hierarchy1.xlsx', 'cells', 'Sheet1!C3'],
    value: JSON.stringify({ value: 456 }) }]);
  await assert.rejects(editor.save(), /chart-shared/, '恢复的共享覆盖在按需入口加载前禁止保存');
  assert.throws(() => edit.copyElements(editor.doc, [frames[0].id]), /chart-shared/,
    '共享覆盖恢复后，未加载的编辑入口不能复制旧原生数据');
  const notifications = [];
  editor.subscribe(change => notifications.push(change));
  chart.registerSharedChartEditing();
  await verifyLegacy();
  assert.deepEqual(frames.map(frame => basicChart.queryChartData(editor.doc, frame.id).series[0].points[1].value),
    [456, 456, 456], '共享入口注册后既有普通 SDK 也立即读取同一份文档状态');
  assert.ok(frames.every((frame, index) => JSON.stringify(editor.effectiveElement(frame.id)) !== original[index]),
    '延迟注册使已缓存的全部图表投影失效');
  assert.ok(frames.every(frame => notifications.some(change => change.renderElements.has(frame.id))),
    '延迟注册发出完整重绘通知');
  const saved = await editor.save(), reopened = await core.parse(saved, { edit: true, keepPackage: true, lazy: false });
  const doc = edit.createDoc(reopened);
  assert.deepEqual(chart.listEditableCharts(doc).map(frame => chart.queryChartData(doc, frame.id).series[0].points[1].value),
    [456, 456, 456]);
  editor.dispose(); presentation.dispose(); reopened.dispose();
}
