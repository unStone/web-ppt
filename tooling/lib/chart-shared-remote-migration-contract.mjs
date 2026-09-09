import { peers, release, setValue, views } from './chart-shared-legacy-migration-contract.mjs';

export async function runRemoteMigration(context) {
  const network = await peers({ ...context, collab: context.migration }, 'remote-migration'), [a, b] = network.result;
  try {
    a.editor.exec({ type: 'DuplicateSlide', id: a.editor.doc.elements[a.data.chartId].parent });
    const copy = views(context.basic, a)[1];
    setValue(b, 111); setValue(b, 777); setValue(b, 888);
    const [first, second, third] = network.take('a');
    const ids = new Map([[b.data.chartId, copy.chartId], [b.data.series[0].id, copy.series[0].id],
      [b.data.series[0].points[0].id, copy.series[0].points[0].id]]);
    const copied = { ...second, patches: second.patches.map(patch => ({ ...patch, path: patch.path.map(key => ids.get(key) ?? key) })) };
    context.freshProcess('remote-migration-resume', { first, copied, third, chartId: a.data.chartId,
      part: a.data.binding.chartPart, idPrefix: a.editor.doc.identity.prefix });
  } finally { network.result.forEach(release); }
}

export async function resumeRemoteMigration({ assert, core, edit, migration, loadShared, input }, payload) {
  const opened = [], errors = [];
  const open = async (replicaId, replicaSlot, recoveryFrames, checkpoint) => {
    const source = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const doc = edit.createDoc(source, { idPrefix: payload.idPrefix });
    const editor = new edit.Editor(doc, { recoveryFrames }), sent = [], frames = [];
    let receive;
    editor.subscribeRecovery(frame => frames.push(frame));
    const binding = migration.bindCollaboration(editor, { documentId: 'remote-migration', replicaId, replicaSlot, checkpoint,
      provider: { send(message) { sent.push(structuredClone(message)); }, subscribe(listener) { receive = listener; return () => {}; } },
      onError: error => errors.push(error) });
    const peer = { source, editor, binding, sent, frames, receive }; opened.push(peer); return peer;
  };
  try {
    const a = await open('a', 0), c = await open('c', 2);
    a.editor.exec({ type: 'DuplicateSlide', id: a.editor.doc.elements[payload.chartId].parent });
    c.receive(a.sent[0]);
    for (const peer of [a, c]) { peer.receive(payload.first); peer.receive(payload.copied); }
    c.receive(payload.third); assert.deepEqual(errors, []);
    const shared = await loadShared(); shared.registerSharedChartEditing();
    const states = peer => shared.listEditableCharts(peer.editor.doc).filter(chart => chart.binding.chartPart === payload.part)
      .map(chart => shared.queryChartData(peer.editor.doc, chart.id));
    const values = peer => states(peer).map(state => state.series[0].points[0].value);
    const set = (peer, value) => {
      const state = states(peer)[0];
      shared.createChartDataEditor(peer.editor).setValue(state.chartId, state.series[0].id, state.series[0].points[0].id, value);
    };
    assert.deepEqual(values(a), [777, 777]); assert.deepEqual(values(c), [888, 888]);
    set(c, 1000); set(c, 1001); set(a, 999);
    a.editor.markSaved(); c.editor.markSaved();
    const historyBefore = a.editor.history.undoCount;
    assert.ok(historyBefore > 0);
    const outgoing = a.sent[1], [first, second] = c.sent;
    assert.ok(outgoing.patches.some(edit.isExtensionMigrationPatch), '下一条正常消息携带未宣布凭据');
    assert.ok(first.patches.some(edit.isExtensionMigrationPatch));
    const invalid = structuredClone(outgoing);
    invalid.patches.push({ op: 'set', origin: 'legacy', value: 'bad',
      path: ['document', 'extensions', 'chart-shared', payload.part, 'dataset', 'series', 's0', 'points', 'c1', 'value'] });
    const before = JSON.stringify({ elements: c.editor.doc.elements, extensions: c.editor.doc.extensions,
      identity: c.editor.doc.identity, checkpoint: c.binding.checkpoint(), frames: c.frames });
    c.receive(invalid);
    assert.equal(errors.length, 1); errors.length = 0;
    assert.equal(JSON.stringify({ elements: c.editor.doc.elements, extensions: c.editor.doc.extensions,
      identity: c.editor.doc.identity, checkpoint: c.binding.checkpoint(), frames: c.frames }), before, '坏批次回滚模型、原版本、身份和恢复序号');
    c.receive(outgoing);
    assert.deepEqual(errors, []); assert.deepEqual(values(c), [1001, 1001], '旧远端凭据不能覆盖本地更晚原操作');
    assert.equal(c.editor.isDirty(), false, '纯迁移元数据及落败字段不改变保存状态');
    a.receive(second);
    assert.deepEqual(values(a), [999, 999], '缺前序消息时整组延迟');
    a.receive(first);
    assert.deepEqual(values(a), [1001, 1001], '延迟组消费时须针对前序已提交版本重新裁决');
    assert.equal(a.editor.isDirty(), true, '带迁移凭据的正常远端编辑必须标脏');
    assert.equal(a.editor.history.undoCount, historyBefore - 1, '真实字段足迹清理冲突编辑历史');
    a.receive(payload.third); a.receive(first);
    assert.deepEqual(values(a), [1001, 1001]); assert.deepEqual(errors, []);
    for (const peer of [a, c]) {
      const checkpoint = peer.binding.checkpoint();
      assert.ok(!checkpoint.registers.some(([key]) => key.includes('edit-migrations')), '凭据不产生运输时钟寄存器');
      const winner = checkpoint.extensionOperations.find(([, operation]) => operation.value === 1001);
      assert.ok(winner);
      assert.deepEqual(checkpoint.registers.find(([key]) => key === winner[0])[1].stamp, second.stamp, '赢家保留原字段消息时钟');
    }
    const cold = await open('a', 0, a.frames, a.binding.checkpoint());
    assert.deepEqual(values(cold), [1001, 1001], '先恢复文档、后绑定 checkpoint 仍保留双端裁决结果');
    assert.deepEqual(cold.binding.checkpoint().registers, a.binding.checkpoint().registers);
    assert.deepEqual(cold.binding.checkpoint().extensionOperations, a.binding.checkpoint().extensionOperations);
  } finally {
    for (const peer of opened) { peer.binding.dispose(); peer.editor.dispose(); edit.disposeDoc(peer.editor.doc); peer.source.dispose(); }
  }
}
