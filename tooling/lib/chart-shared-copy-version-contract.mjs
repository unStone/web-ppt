import { peers, release, setValue, views } from './chart-shared-legacy-migration-contract.mjs';

export async function runChartCopyVersions(context) {
  const network = await peers({ ...context, collab: context.migration }, 'versioned-copy'), [a, b] = network.result;
  const { assert, basic } = context;
  try {
    setValue(a, 111);
    const [first] = network.take('b'); network.deliver('b', first);
    a.editor.exec({ type: 'DuplicateSlide', id: a.editor.doc.elements[a.data.chartId].parent });
    const [copyMessage] = network.take('b'), copy = views(basic, a)[1];
    const copiedPath = ['elements', copy.chartId, ...first.patches[0].path.slice(2)];
    const copiedRegister = a.binding.checkpoint().registers.find(([key]) => key === JSON.stringify(copiedPath));
    assert.deepEqual(copiedRegister?.[1].stamp, first.stamp, '副本继承复制时真实来源版本，不用复制时钟');
    setValue(b, 777);
    const [changed] = network.take('a');
    for (const scenario of ['normal', 'removed-source', 'copy-chain']) {
      context.freshProcess('versioned-copy-resume', { a: { frames: a.frames, checkpoint: a.binding.checkpoint() },
        b: { frames: b.frames, checkpoint: b.binding.checkpoint() }, first, copyMessage, changed, scenario,
        copiedPath, part: a.data.binding.chartPart, idPrefix: a.editor.doc.identity.prefix });
    }
    assert.deepEqual(network.errors, []);
  } finally { network.result.forEach(release); }
}

export async function resumeChartCopyVersions({ assert, core, edit, migration, loadShared, input }, payload) {
  const peers = [], errors = [];
  try {
    for (const [replicaSlot, replicaId] of ['a', 'b'].entries()) {
      const source = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
      const editor = new edit.Editor(edit.createDoc(source, { idPrefix: payload.idPrefix }),
        { recoveryFrames: payload[replicaId].frames });
      const frames = [...payload[replicaId].frames]; editor.subscribeRecovery(frame => frames.push(frame));
      let receive;
      const binding = migration.bindCollaboration(editor, { documentId: 'versioned-copy', replicaId, replicaSlot,
        checkpoint: payload[replicaId].checkpoint,
        provider: { send() {}, subscribe(listener) { receive = listener; return () => {}; } }, onError: error => errors.push(error) });
      peers.push({ source, editor, binding, receive, frames });
    }
    const [a, b] = peers;
    a.receive(payload.changed);
    for (const message of payload.beforeCopy ?? []) b.receive(message);
    if (payload.scenario === 'removed-source') b.editor.exec({ type: 'RemoveSlide',
      id: b.editor.doc.elements[payload.first.patches[0].path[1]].parent });
    const state = () => JSON.stringify([b.editor.doc.slideOrder, b.editor.doc.elements, b.editor.doc.extensions,
      b.editor.doc.identity, b.binding.checkpoint(), b.frames]);
    const before = state();
    for (const kind of ['future', 'value', 'stamp']) {
      const invalid = structuredClone(payload.copyMessage), copy = invalid.patches.find(patch => patch.op === 'insert').value;
      const proof = JSON.parse(copy.extensionCopies);
      if (kind === 'future') proof[0].stamp.clock = invalid.stamp.clock + 1;
      else if (kind === 'value') { proof[0].op = 'set'; proof[0].value = 999; }
      copy.extensionCopies = JSON.stringify(proof);
      if (kind === 'stamp') copy.extensionCopies = copy.extensionCopies.replace(/"stamp":\{([^{}]+)\}/,
        (_, fields) => `"stamp":{${fields},"extra":${'['.repeat(3500)}0${']'.repeat(3500)}}`);
      b.receive(invalid);
      assert.equal(errors.length, 1); errors.length = 0;
      assert.ok(state() === before, '无效复制证据不改变模型、寄存器、恢复帧或序号');
    }
    b.receive(payload.copyMessage);
    assert.deepEqual(errors, []);
    for (const peer of peers) assert.deepEqual(peer.binding.checkpoint().registers
      .find(([key]) => key === JSON.stringify(payload.copiedPath))?.[1].stamp, payload.first.stamp,
    '迟到复制沿用发送端复制时的原操作，不能借用当前来源版本');
    if (payload.scenario === 'copy-chain') {
      const source = payload.copiedPath[1];
      const transaction = a.editor.exec({ type: 'DuplicateSlide', id: a.editor.doc.elements[source].parent });
      const snapshot = transaction.forward[0].value;
      const id = Object.keys(snapshot.copySources).find(id => snapshot.copySources[id] === source);
      assert.ok(id);
      const key = JSON.stringify(['elements', id, ...payload.copiedPath.slice(2)]);
      assert.deepEqual(a.binding.checkpoint().registers.find(([candidate]) => candidate === key)?.[1].stamp,
        payload.first.stamp, '副本再复制继承直接来源，不能读取已经变化的最初原件版本');
    }
    const shared = await loadShared(); shared.registerSharedChartEditing();
    const values = editor => shared.listEditableCharts(editor.doc).filter(chart => chart.binding.chartPart === payload.part)
      .map(chart => shared.queryChartData(editor.doc, chart.id).series[0].points[0].value);
    const expected = payload.expected ?? 777;
    const counts = [payload.scenario === 'copy-chain' ? 3 : 2, payload.scenario === 'removed-source' ? 1 : 2];
    for (const [index, peer] of peers.entries()) assert.deepEqual(values(peer.editor), Array(counts[index]).fill(expected));
    a.editor.undo(); a.editor.redo();
    assert.deepEqual(values(a.editor), Array(counts[0]).fill(expected), '复制的旧重做快照不能覆盖后来的来源版本');
    const source = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const cold = new edit.Editor(edit.createDoc(source, { idPrefix: payload.idPrefix }), { recoveryFrames: a.frames });
    try { assert.deepEqual(values(cold), Array(counts[0]).fill(expected)); }
    finally { cold.dispose(); edit.disposeDoc(cold.doc); source.dispose(); }
    assert.deepEqual(errors, []);
  } finally {
    for (const peer of peers) { peer.binding.dispose(); peer.editor.dispose(); edit.disposeDoc(peer.editor.doc); peer.source.dispose(); }
  }
}

export async function runChartCopyDeletion(context) {
  const network = await peers({ ...context, collab: context.migration }, 'versioned-copy'), [a, b] = network.result;
  const { assert, basic } = context;
  try {
    const expected = a.data.series[0].points[0].value;
    a.api.removeCategory(a.data.chartId, a.data.categories[0].id); a.editor.undo();
    const beforeCopy = network.take('b'), first = beforeCopy[1];
    assert.equal(first.patches[0].op, 'del');
    a.editor.exec({ type: 'DuplicateSlide', id: a.editor.doc.elements[a.data.chartId].parent });
    const [copyMessage] = network.take('b'), copy = views(basic, a)[1];
    const copiedPath = ['elements', copy.chartId, ...first.patches[0].path.slice(2)];
    const checkpoint = a.binding.checkpoint();
    assert.deepEqual(checkpoint.registers.find(([key]) => key === JSON.stringify(copiedPath))?.[1].stamp, first.stamp);
    assert.deepEqual(checkpoint.extensionOperations.find(([key]) => key === JSON.stringify(copiedPath))?.[1], { op: 'del' },
      '复制空覆盖仍继承真实删除，不能把不存在的叶当成未知');
    b.api.removeCategory(b.data.chartId, b.data.categories[0].id); const [changed] = network.take('a');
    context.freshProcess('versioned-copy-resume', { a: { frames: a.frames, checkpoint },
      b: { frames: b.frames, checkpoint: b.binding.checkpoint() }, first, copyMessage, changed, beforeCopy,
      copiedPath, part: a.data.binding.chartPart, idPrefix: a.editor.doc.identity.prefix, expected });
  } finally { network.result.forEach(release); }
}

export async function runChartCopyTransaction(context) {
  const network = await peers({ ...context, collab: context.migration }, 'versioned-copy-transaction'), [a] = network.result;
  const { assert, basic } = context;
  try {
    setValue(a, 111); network.take('b');
    a.editor.transaction(tx => {
      tx.exec({ type: 'Extension', namespace: 'chart-data', id: a.data.chartId,
        payload: { op: 'set-point', seriesId: a.data.series[0].id, pointId: a.data.series[0].points[0].id, value: 777 } });
      tx.exec({ type: 'DuplicateSlide', id: a.editor.doc.elements[a.data.chartId].parent });
    }, '先写入再复制');
    const [message] = network.take('b'), snapshot = message.patches.find(patch => patch.op === 'insert').value;
    const inputs = JSON.parse(snapshot.extensionCopies);
    assert.ok(inputs.some(input => input.op === 'set' && input.value === 777));
    assert.ok(inputs.every(input => input.stamp.clock === message.stamp.clock && input.stamp.replicaId === message.replicaId),
      '同批较早的真实字段写入提供原版本');
    const copy = views(basic, a)[1], copyKey = JSON.stringify(['elements', copy.chartId, ...message.patches[0].path.slice(2)]);
    assert.deepEqual(a.binding.checkpoint().registers.find(([key]) => key === copyKey)?.[1].stamp, message.stamp);
    const before = JSON.stringify([a.binding.checkpoint(), a.frames, a.editor.doc.slideOrder, a.editor.doc.identity]);
    assert.throws(() => a.editor.transaction(tx => {
      tx.exec({ type: 'DuplicateSlide', id: a.editor.doc.elements[a.data.chartId].parent });
      tx.exec({ type: 'SetName', id: a.data.chartId, name: 123 });
    }, '复制后失败'));
    assert.ok(JSON.stringify([a.binding.checkpoint(), a.frames, a.editor.doc.slideOrder, a.editor.doc.identity]) === before,
      '失败复制不消耗原证据、身份、序号或恢复帧');
    assert.ok(a.editor.undo());
    const state = () => JSON.stringify([a.editor.doc.elements, a.editor.doc.extensions, a.editor.doc.identity,
      a.binding.checkpoint(), a.frames, a.editor.history.undoEntries, a.editor.history.redoEntries]);
    const prior = state();
    assert.throws(() => a.editor.transaction(tx => {
      const point = value => ({ type: 'Extension', namespace: 'chart-data', id: a.data.chartId,
        payload: { op: 'set-point', seriesId: a.data.series[0].id, pointId: a.data.series[0].points[0].id, value } });
      tx.exec(point(777));
      tx.exec({ type: 'DuplicateSlide', id: a.editor.doc.elements[a.data.chartId].parent });
      tx.exec(point(999));
    }, '局部入口不能继续写已经共享的原图表'), '多个框架形成后必须由共享入口编辑');
    assert.equal(state(), prior, '被拒绝的同批复制后局部写入必须完整回滚');
    assert.deepEqual(network.errors, []);
  } finally { network.result.forEach(release); }
}
