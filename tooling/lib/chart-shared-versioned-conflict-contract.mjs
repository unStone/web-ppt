import { peers, release, setValue, views } from './chart-shared-legacy-migration-contract.mjs';

export async function runVersionedChartConflict(context) {
  const network = await peers({ ...context, collab: context.migration }, 'versioned-conflict'), [a, b] = network.result;
  try {
    a.editor.exec({ type: 'DuplicateSlide', id: a.editor.doc.elements[a.data.chartId].parent });
    const copy = views(context.basic, a)[1];
    setValue(b, 111); setValue(b, 777);
    const [first, second] = network.take('a');
    // 旧 provider 允许逐框架编辑；原 stamp 来自真实消息，只按复制身份映射第二个框架的地址。
    const ids = new Map([[b.data.chartId, copy.chartId], [b.data.series[0].id, copy.series[0].id],
      [b.data.series[0].points[0].id, copy.series[0].points[0].id]]);
    const copied = { ...second, patches: second.patches.map(patch => ({ ...patch, path: patch.path.map(key => ids.get(key) ?? key) })) };
    context.freshProcess('versioned-conflict-resume', { first, copied, chartId: a.data.chartId,
      part: a.data.binding.chartPart, idPrefix: a.editor.doc.identity.prefix });
  } finally { network.result.forEach(release); }
}

export async function resumeVersionedChartConflict({ assert, core, edit, migration, loadShared, input }, payload) {
  const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(presentation, { idPrefix: payload.idPrefix }));
  const errors = [], frames = []; let binding, receive;
  try {
    editor.subscribeRecovery(frame => frames.push(frame));
    binding = migration.bindCollaboration(editor, { documentId: 'versioned-conflict', replicaId: 'a', replicaSlot: 0,
      provider: { send() {}, subscribe(listener) { receive = listener; return () => {}; } }, onError: error => errors.push(error) });
    editor.exec({ type: 'DuplicateSlide', id: editor.doc.elements[payload.chartId].parent });
    receive(payload.first); receive(payload.copied);
    assert.deepEqual(errors, []);
    const before = binding.checkpoint();
    assert.deepEqual(before.extensionOperations.filter(([, operation]) => operation.op === 'set')
      .map(([, operation]) => operation.value).sort((a, b) => a - b), [111, 777]);
    editor.markSaved();
    const identity = structuredClone(editor.doc.identity), history = editor.history.undoCount;
    const shared = await loadShared(); shared.registerSharedChartEditing();
    const states = () => shared.listEditableCharts(editor.doc).filter(chart => chart.binding.chartPart === payload.part)
      .map(chart => shared.queryChartData(editor.doc, chart.id));
    assert.deepEqual(states().map(state => state.series[0].points[0].value), [777, 777], '带原版本的冲突自动裁决为最新原操作');
    assert.ok(states().every(state => state.binding.mode !== 'readonly'));
    assert.deepEqual(editor.doc.identity, identity, '迁移不增加时钟或消息序号');
    assert.equal(editor.history.undoCount, history);
    assert.equal(editor.isDirty(), false);
    const migrated = binding.checkpoint(), winner = migrated.extensionOperations.find(([, operation]) => operation.value === 777);
    assert.ok(winner[0].startsWith('["document","extensions","chart-shared"'));
    assert.deepEqual(migrated.registers.find(([key]) => key === winner[0])[1].stamp, payload.copied.stamp);
    const state = states()[0];
    shared.createChartDataEditor(editor).setValue(state.chartId, state.series[0].id, state.series[0].points[0].id, 999);
    assert.deepEqual(states().map(state => state.series[0].points[0].value), [999, 999]);
    editor.undo(); assert.deepEqual(states().map(state => state.series[0].points[0].value), [777, 777]);
    editor.redo(); assert.deepEqual(states().map(state => state.series[0].points[0].value), [999, 999]);
    const saved = await core.parse(await editor.save(), { edit: true, keepPackage: true, lazy: false });
    const reopened = edit.createDoc(saved);
    try { assert.deepEqual(shared.listEditableCharts(reopened).filter(chart => chart.binding.chartPart === payload.part)
      .map(chart => shared.queryChartData(reopened, chart.id).series[0].points[0].value), [999, 999]); }
    finally { edit.disposeDoc(reopened); saved.dispose(); }
    const source = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const cold = new edit.Editor(edit.createDoc(source, { idPrefix: payload.idPrefix }), { recoveryFrames: frames });
    try { assert.deepEqual(shared.listEditableCharts(cold.doc).filter(chart => chart.binding.chartPart === payload.part)
      .map(chart => shared.queryChartData(cold.doc, chart.id).series[0].points[0].value), [999, 999]); }
    finally { cold.dispose(); edit.disposeDoc(cold.doc); source.dispose(); }
    assert.deepEqual(errors, []);
  } finally { binding?.dispose(); editor.dispose(); edit.disposeDoc(editor.doc); presentation.dispose(); }
}
