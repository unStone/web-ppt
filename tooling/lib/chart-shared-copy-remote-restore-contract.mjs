export async function resumeChartCopyRemoteRestore({ assert, core, edit, migration, loadShared, input }, payload) {
  const peers = [], errors = [], options = { edit: true, keepPackage: true, lazy: false };
  try {
    for (const [replicaId, replicaSlot] of [['a', 0], ['c', 2]]) {
      const source = await core.parse(input, options);
      const editor = new edit.Editor(edit.createDoc(source, { idPrefix: payload.idPrefix }));
      let receive; const sent = [], frames = [];
      editor.subscribeRecovery(frame => frames.push(frame));
      const binding = migration.bindCollaboration(editor, { documentId: 'versioned-copy-redo', replicaId, replicaSlot,
        provider: { send: message => sent.push(structuredClone(message)), subscribe: listener => { receive = listener; return () => {}; } },
        onError: error => errors.push(error) });
      peers.push({ source, editor, binding, receive, sent, frames });
    }
    const [a, c] = peers;
    a.receive(payload.first); c.receive(payload.first);
    const source = payload.first.patches[0].path[1];
    a.editor.exec({ type: 'DuplicateSlide', id: a.editor.doc.elements[source].parent });
    const copy = a.sent.shift(); c.receive(copy);
    const tree = copy.patches.find(patch => patch.op === 'insert').value;
    const target = Object.keys(tree.copySources).find(id => tree.copySources[id] === source);
    a.receive(payload.changed);
    const value = () => payload.changed.patches[0].path.slice(2)
      .reduce((value, key) => value?.[key], a.editor.doc.elements[target]);
    assert.equal(value(), 777);
    let shared;
    if (payload.preloaded) { shared = await loadShared(); shared.registerSharedChartEditing(); }
    // C 尚未收到新值，公开 RemoveSlide/undo 自然产生旧恢复快照，不手工修改结构消息。
    c.editor.exec({ type: 'RemoveSlide', id: tree.slide.id }); assert.ok(c.editor.undo());
    const [remove, restore] = c.sent;
    let expected = 777, stamp = payload.changed.stamp;
    if (payload.deferred) {
      a.receive(restore); a.receive(payload.newest); a.receive(remove);
      expected = 889; stamp = payload.newest.stamp;
    } else {
      a.receive(remove);
      const state = () => JSON.stringify([a.editor.doc.elements, a.editor.doc.slideOrder, a.editor.doc.extensions,
        a.editor.doc.identity, a.binding.checkpoint(), a.frames, a.editor.history.undoEntries, a.editor.history.redoEntries]);
      const before = state(), invalid = structuredClone(restore);
      invalid.patches.push({ op: 'set', origin: 'remote', path: ['elements', source, 'ovr', 'name'], value: 123 });
      a.receive(invalid); assert.equal(errors.length, 1); errors.length = 0;
      assert.ok(state() === before, '重基后的坏恢复批次仍须完整回滚');
      a.receive(restore);
    }
    assert.deepEqual(errors, []);
    if (!shared) assert.equal(value(), expected, '其他副本的旧恢复快照也不能重置接收端已获胜的字段');
    shared ??= await loadShared(); shared.registerSharedChartEditing();
    const values = doc => shared.listEditableCharts(doc).filter(chart => chart.binding.chartPart === payload.part)
      .map(chart => shared.queryChartData(doc, chart.id).series[0].points[0].value);
    assert.deepEqual(values(a.editor.doc), [expected, expected]);
    const key = JSON.stringify(edit.canonicalExtensionPath(a.editor.doc, payload.changed.patches[0].path));
    assert.deepEqual(a.binding.checkpoint().registers.find(([path]) => path === key)?.[1].stamp, stamp);
    const checkpoint = JSON.stringify([a.binding.checkpoint(), a.frames]);
    a.receive(restore); assert.equal(JSON.stringify([a.binding.checkpoint(), a.frames]), checkpoint);
    const coldSource = await core.parse(input, options);
    const cold = new edit.Editor(edit.createDoc(coldSource, { idPrefix: payload.idPrefix }), { recoveryFrames: a.frames });
    try { assert.deepEqual(values(cold.doc), [expected, expected]); }
    finally { cold.dispose(); edit.disposeDoc(cold.doc); coldSource.dispose(); }
    const saved = await core.parse(await a.editor.save(), options), savedDoc = edit.createDoc(saved);
    try { assert.deepEqual(values(savedDoc), [expected, expected]); }
    finally { edit.disposeDoc(savedDoc); saved.dispose(); }
  } finally {
    for (const peer of peers) { peer.binding.dispose(); peer.editor.dispose(); edit.disposeDoc(peer.editor.doc); peer.source.dispose(); }
  }
}
