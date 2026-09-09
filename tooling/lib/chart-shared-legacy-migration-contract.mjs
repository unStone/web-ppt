const options = { edit: true, keepPackage: true, lazy: false };

export async function openLegacy({ core, edit, basic, input, chartIndex = 0 }, suffix = '') {
  const presentation = await core.parse(input, options);
  const editor = new edit.Editor(edit.createDoc(presentation, { idPrefix: 'legacy-migration-' }), { origin: suffix || 'local' });
  const data = basic.queryChartData(editor.doc, basic.listEditableCharts(editor.doc)[chartIndex].id);
  return { presentation, editor, data, api: basic.createChartDataEditor(editor),
    disposeDoc: () => edit.disposeDoc(editor.doc) };
}
export const setValue = (peer, value) => peer.api.setValue(peer.data.chartId,
  peer.data.series[0].id, peer.data.series[0].points[0].id, value);
export const views = (basic, peer) => basic.listEditableCharts(peer.editor.doc)
  .filter(frame => frame.binding.chartPart === peer.data.binding.chartPart)
  .map(frame => basic.queryChartData(peer.editor.doc, frame.id));
export const values = (basic, peer) => views(basic, peer).map(data => data.series[0].points[0].value);
export const release = peer => { peer.binding?.dispose(); peer.editor.dispose(); peer.disposeDoc(); peer.presentation.dispose(); };

export async function runLegacyMigrationHistory(context) {
  const { core, edit, basic, shared, assert, input } = context;
  const peer = await openLegacy(context), frames = [];
  peer.editor.subscribeRecovery(frame => frames.push(frame));
  try {
    const baseline = values(basic, peer)[0];
    setValue(peer, 919);
    const undoCount = peer.editor.history.undoCount;
    shared.registerSharedChartEditing();
    assert.deepEqual(values(basic, peer), [919], '加载共享入口保留当前数据');
    assert.equal(peer.editor.history.undoCount, undoCount, '迁移不增加用户撤销步骤');
    peer.editor.exec({ type: 'DuplicateSlide', id: peer.editor.doc.elements[peer.data.chartId].parent });
    assert.deepEqual(values(basic, peer), [919, 919], '旧局部编辑复制后由两个框架共同读取');
    const bytes = await peer.editor.save();
    const reopened = await core.parse(bytes, options);
    let savedDoc;
    try {
      savedDoc = edit.createDoc(reopened);
      const saved = basic.listEditableCharts(savedDoc).filter(frame => frame.binding.chartPart === peer.data.binding.chartPart);
      assert.equal(saved.length, 2);
      assert.deepEqual(saved.map(frame => basic.queryChartData(savedDoc, frame.id).series[0].points[0].value), [919, 919]);
    } finally { if (savedDoc) edit.disposeDoc(savedDoc); reopened.dispose(); }
    peer.editor.undo();
    peer.editor.undo();
    assert.deepEqual(values(basic, peer), [baseline], '迁移前的旧历史仍能完整撤销');
    peer.editor.redo(); peer.editor.redo();
    assert.deepEqual(values(basic, peer), [919, 919], '旧历史重做重新联动两个框架');
    peer.editor.exec({ type: 'RemoveElement', id: peer.data.chartId });
    assert.deepEqual(values(basic, peer), [919], '删除原框架不删除共享数据');
    const coldSource = await core.parse(input, options);
    const cold = new edit.Editor(edit.createDoc(coldSource, { idPrefix: peer.editor.doc.identity.prefix }), { recoveryFrames: frames });
    try { assert.deepEqual(values(basic, { ...peer, editor: cold }), [919], '冷恢复保留删除原框架后的旧编辑'); }
    finally { cold.dispose(); edit.disposeDoc(cold.doc); coldSource.dispose(); }
    await peer.editor.save();
  } finally { release(peer); }
}

export async function peers(context, name) {
  const deliveries = [], listeners = new Map(), errors = [];
  const result = [];
  for (const [slot, replicaId] of ['a', 'b'].entries()) {
    const peer = await openLegacy(context, replicaId);
    peer.frames = [];
    peer.editor.subscribeRecovery(frame => peer.frames.push(frame));
    peer.binding = context.collab.bindCollaboration(peer.editor, {
      documentId: name, replicaId, replicaSlot: slot,
      provider: {
        send: message => deliveries.push({ to: replicaId === 'a' ? 'b' : 'a', message: structuredClone(message) }),
        subscribe: listener => { listeners.set(replicaId, listener); return () => listeners.delete(replicaId); },
      }, onError: error => errors.push(error),
    });
    result.push(peer);
  }
  const take = to => {
    const selected = deliveries.filter(item => item.to === to).map(item => item.message);
    for (let index = deliveries.length - 1; index >= 0; index--) if (deliveries[index].to === to) deliveries.splice(index, 1);
    return selected;
  };
  return { result, take, listeners, errors, deliver: (to, message) => listeners.get(to)(structuredClone(message)) };
}

export async function runLegacyMigrationMessages(context) {
  const { shared, basic, assert } = context;
  const network = await peers(context, 'legacy-migration-messages');
  const [a, b] = network.result;
  try {
    setValue(a, 110); setValue(b, 220);
    network.take('b').forEach(message => network.deliver('b', message));
    network.take('a').forEach(message => network.deliver('a', message));
    setValue(a, 330); setValue(a, 550);
    const [older, later] = network.take('b');
    setValue(b, 440);
    const before = b.binding.checkpoint();
    const legacyKey = JSON.stringify(older.patches[0].path);
    const oldStamp = before.registers.find(([key]) => key === legacyKey)[1].stamp;
    shared.registerSharedChartEditing();
    shared.queryChartData(b.editor.doc, b.data.chartId);
    b.editor.exec({ type: 'DuplicateSlide', id: b.editor.doc.elements[b.data.chartId].parent });
    b.editor.exec({ type: 'RemoveElement', id: b.data.chartId });
    network.deliver('b', older);
    assert.deepEqual(values(basic, b), [440], '迁移前较旧消息不能覆盖原来获胜的字段');
    const migrated = b.binding.checkpoint();
    network.deliver('b', later); network.deliver('b', later);
    assert.deepEqual(values(basic, b), [550], '原框架删除后，较新的旧地址消息仍更新幸存图表且重复幂等');
    // 用同一语义字段的新命令公开地址定位旧 checkpoint，不猜测内部来源身份编码。
    const survivor = views(basic, b)[0], emitted = [];
    const unsubscribe = b.editor.subscribePatches(event => emitted.push(...event.patches));
    try { shared.createChartDataEditor(b.editor).setValue(survivor.chartId,
      survivor.series[0].id, survivor.series[0].points[0].id, 7711); }
    finally { unsubscribe(); }
    const fields = emitted.filter(patch => patch.op === 'set' && patch.value === 7711);
    assert.equal(fields.length, 1, '同一数据点通过唯一共享字段寻址');
    const key = JSON.stringify(fields[0].path);
    assert.deepEqual(migrated.registers.find(([candidate]) => candidate === key)?.[1].stamp, oldStamp,
      '被编辑字段保留原来的 LWW 时钟，不用迁移操作的新时钟盖住它');
    assert.deepEqual(network.errors, []);
  } finally { network.result.forEach(release); }
}

export async function runLegacyMigrationCheckpoint(context) {
  const { shared, assert } = context;
  const documentId = 'legacy-migration-checkpoint', network = await peers(context, documentId);
  const [a, b] = network.result;
  try {
    setValue(a, 111); network.take('b').forEach(message => network.deliver('b', message));
    setValue(a, 222); setValue(a, 333);
    const [missing, later] = network.take('b');
    network.deliver('b', later);
    assert.ok(b.binding.checkpoint().deferred.length > 0, '加载共享入口前已有待处理的旧地址消息');
    shared.registerSharedChartEditing();
    shared.queryChartData(b.editor.doc, b.data.chartId);
    b.editor.exec({ type: 'DuplicateSlide', id: b.editor.doc.elements[b.data.chartId].parent });
    b.editor.exec({ type: 'RemoveElement', id: b.data.chartId });
    const checkpoint = b.binding.checkpoint();
    // checkpoint 协议把寄存器键视为透明字符串；不能要求未知扩展也使用当前 JSON 路径编码。
    checkpoint.registers.push(['["elements","future', { stamp: missing.stamp, kind: 'field' }]);
    assert.ok(checkpoint.deferred.length > 0, '确实保存一条因消息缺口延迟的旧地址消息');
    for (const entry of checkpoint.deferred) {
      assert.deepEqual(entry.patch, entry.message.patches[entry.ordinal], 'checkpoint 中的原消息与 ordinal 始终一致');
      assert.deepEqual(entry.message, later, '迁移不能改写已接收的原始消息体');
    }
    b.binding.dispose();
    assert.deepEqual(network.errors, []);
    await context.resumeCheckpoint({ documentId, checkpoint, frames: b.frames, missing,
      idPrefix: b.editor.doc.identity.prefix, chartPart: b.data.binding.chartPart,
    });
  } finally { network.result.forEach(release); }
}

export async function resumeLegacyMigrationCheckpoint(context, payload) {
  const { core, edit, basic, shared, collab, assert, input } = context;
  const { documentId, checkpoint, frames, missing, idPrefix, chartPart } = payload;
  const presentation = await core.parse(input, options);
  let resumed;
  try {
    // 新进程尚未注册共享实现；恢复记录不能依赖旧进程的内存映射或来源缓存。
    const editor = new edit.Editor(edit.createDoc(presentation, { idPrefix }), { recoveryFrames: frames });
    resumed = { editor, presentation, data: { binding: { chartPart } },
      disposeDoc: () => edit.disposeDoc(editor.doc) };
    shared.registerSharedChartEditing();
    shared.queryChartData(editor.doc, views(basic, resumed)[0].chartId);
    let receive;
    const errors = [];
    resumed.binding = collab.bindCollaboration(editor, {
      documentId, replicaId: 'b', replicaSlot: 1, checkpoint,
      provider: { send() {}, subscribe: listener => { receive = listener; return () => {}; } },
      onError: error => errors.push(error),
    });
    receive(missing);
    assert.deepEqual(values(basic, resumed), [333], '重启后旧前序消息补齐缺口，再消费延迟的新值');
    assert.equal(resumed.binding.checkpoint().deferred.length, 0);
    assert.ok(resumed.binding.checkpoint().registers.some(([key]) => key === '["elements","future'),
      '迁移和冷恢复原样保留无法解释的寄存器键');
    assert.deepEqual(errors, []);
    await editor.save();
  } finally { if (resumed) release(resumed); else presentation.dispose(); }
}
