import { peers, release, setValue, views } from './chart-shared-legacy-migration-contract.mjs';

export async function runChartCopyRedo(context) {
  const network = await peers({ ...context, collab: context.migration }, 'versioned-copy-redo'), [a, b] = network.result;
  try {
    setValue(b, 111); const [first] = network.take('a'); network.deliver('a', first);
    a.editor.exec({ type: 'DuplicateSlide', id: a.editor.doc.elements[a.data.chartId].parent });
    const copy = views(context.basic, a)[1];
    setValue(b, 777); const [later] = network.take('a');
    const changed = { ...later, patches: later.patches.map(patch => ({ ...patch,
      path: ['elements', copy.chartId, ...patch.path.slice(2)] })) };
    setValue(b, 889); const [last] = network.take('a');
    const newest = { ...last, patches: last.patches.map(patch => ({ ...patch,
      path: ['elements', copy.chartId, ...patch.path.slice(2)] })) };
    for (const removed of [false, true]) context.freshProcess('versioned-copy-redo-resume', {
      first, changed: removed ? later : changed, copyId: removed ? a.data.chartId : copy.chartId, removed,
      part: a.data.binding.chartPart, idPrefix: a.editor.doc.identity.prefix });
    for (const preloaded of [false, true]) for (const deferred of [false, true]) {
      context.freshProcess('versioned-copy-remote-restore-resume', { first, changed, newest, preloaded, deferred,
        part: a.data.binding.chartPart, idPrefix: a.editor.doc.identity.prefix });
    }
  } finally { network.result.forEach(release); }
}

export async function resumeChartCopyRedo({ assert, core, edit, migration, loadShared, input }, payload) {
  const options = { edit: true, keepPackage: true, lazy: false };
  const source = await core.parse(input, options), editor = new edit.Editor(edit.createDoc(source, { idPrefix: payload.idPrefix }));
  const errors = [], frames = []; let receive;
  editor.subscribeRecovery(frame => frames.push(frame));
  const binding = migration.bindCollaboration(editor, { documentId: 'versioned-copy-redo', replicaId: 'a', replicaSlot: 0,
    provider: { send() {}, subscribe(listener) { receive = listener; return () => {}; } }, onError: error => errors.push(error) });
  const path = payload.changed.patches[0].path;
  const value = () => path.slice(2).reduce((value, key) => value?.[key], editor.doc.elements[payload.copyId]);
  try {
    receive(payload.first);
    editor.exec({ type: payload.removed ? 'RemoveSlide' : 'DuplicateSlide',
      id: editor.doc.elements[payload.first.patches[0].path[1]].parent });
    if (payload.removed) assert.ok(editor.undo());
    const state = () => JSON.stringify([editor.doc.elements, editor.doc.slideOrder, editor.doc.identity,
      editor.doc.extensions, editor.history.undoEntries, editor.history.redoEntries, binding.checkpoint(), frames]);
    const before = state();
    const releaseResolver = edit.setExtensionMigrationResolver(editor.doc, () => undefined,
      () => { throw new Error('历史派生证据失败'); });
    try { receive(payload.changed); }
    finally { releaseResolver(); }
    assert.equal(errors.length, 1); errors.length = 0;
    assert.equal(state(), before, '历史证据派生失败必须在模型落模前原子拒绝，并允许相同序号重试');
    receive(payload.changed); assert.deepEqual(errors, []);
    assert.equal(payload.removed ? editor.history.redoCount : editor.history.undoCount, 1,
      '远端修改保留页面结构本身的撤销意图');
    assert.equal(value(), 777);
    const slideCount = editor.doc.slideOrder.length;
    assert.ok(payload.removed ? editor.redo() : editor.undo()); assert.equal(editor.doc.slideOrder.length, slideCount - 1);
    assert.equal(editor.doc.elements[payload.copyId], undefined);
    assert.ok(payload.removed ? editor.undo() : editor.redo()); assert.equal(editor.doc.slideOrder.length, slideCount);
    assert.equal(value(), 777, '复制的重做保留已经获胜的副本字段，不能回写旧来源111');
    const checkpoint = binding.checkpoint();
    assert.deepEqual(checkpoint.registers.find(([key]) => key === JSON.stringify(path))?.[1].stamp, payload.changed.stamp);
    const shared = await loadShared(); shared.registerSharedChartEditing();
    const values = doc => shared.listEditableCharts(doc).filter(chart => chart.binding.chartPart === payload.part)
      .map(chart => shared.queryChartData(doc, chart.id).series[0].points[0].value);
    const expected = payload.removed ? [777] : [777, 777];
    assert.deepEqual(values(editor.doc), expected);
    const fresh = await core.parse(input, options), cold = new edit.Editor(edit.createDoc(fresh, { idPrefix: payload.idPrefix }), { recoveryFrames: frames });
    try { assert.deepEqual(values(cold.doc), expected); }
    finally { cold.dispose(); edit.disposeDoc(cold.doc); fresh.dispose(); }
  } finally { binding.dispose(); editor.dispose(); edit.disposeDoc(editor.doc); source.dispose(); }
}

export async function runChartCopyHistorySemantics(context) {
  const { assert } = context;
  const network = await peers({ ...context, collab: context.migration }, 'versioned-copy-history'), [a, b] = network.result;
  try {
    const source = a.data.chartId;
    b.editor.exec({ type: 'SetName', id: b.data.chartId, name: 'one' });
    const [message] = network.take('a');
    // 旧扩展客户端沿同一协同协议发送字段，保留公开编辑产生的真实 stamp 和值。
    network.deliver('a', { ...message, patches: message.patches.map(patch => ({ ...patch,
      path: ['elements', source, 'ovr', 'extensions', 'legacy', 'a', 'b'] })) });
    a.editor.exec({ type: 'DuplicateSlide', id: a.editor.doc.elements[source].parent });
    const tree = a.editor.history.undoEntries[a.editor.history.undoCount - 1].forward.find(patch => patch.op === 'insert').value;
    const target = Object.keys(tree.copySources).find(id => tree.copySources[id] === source);
    assert.ok(JSON.parse(tree.extensionCopies).some(input => input.path[4] === 'legacy' && input.value === 'one'));
    const root = ['elements', target, 'ovr', 'extensions', 'legacy', 'a'];
    const current = () => structuredClone(a.editor.doc.elements[target].ovr.extensions?.legacy);
    const replay = () => {
      const expected = current(); assert.ok(a.editor.undo()); assert.ok(a.editor.redo());
      assert.deepEqual(current(), expected, '结构历史的扩展值必须与核心实时字段语义一致');
    };
    a.editor.applyExternalPatches([{ op: 'del', origin: 'external', path: root }]);
    assert.deepEqual(current(), { a: { b: 'one' } }); replay();
    a.editor.applyExternalPatches([{ op: 'set', origin: 'external', path: root, value: 2 }]); replay();
    a.editor.applyExternalPatches([{ op: 'set', origin: 'external', path: [...root, 'child'], value: 3 }]);
    assert.deepEqual(current(), { a: 2 }); replay();
    a.editor.applyExternalPatches([{ op: 'del', origin: 'external', path: [...root, 'child'] }]); replay();
    assert.deepEqual(network.errors, []);
  } finally { network.result.forEach(release); }
}
