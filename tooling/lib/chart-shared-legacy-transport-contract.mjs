import { openLegacy, release, setValue, values } from './chart-shared-legacy-migration-contract.mjs';

function bind(context, peer, replicaId, send, checkpoint) {
  let receive;
  const errors = [];
  peer.binding = context.collab.bindCollaboration(peer.editor, {
    documentId: 'legacy-transport', replicaId, replicaSlot: replicaId === 'a' ? 0 : 1, checkpoint,
    provider: { send, subscribe: listener => { receive = listener; return () => {}; } },
    onError: error => errors.push(error),
  });
  return { receive: message => receive(structuredClone(message)), errors };
}

export async function runLegacyMigrationAnnouncements(context) {
  const { shared, assert } = context, peer = await openLegacy(context, 'a'), messages = [];
  try {
    const network = bind(context, peer, 'a', message => messages.push(message));
    setValue(peer, 110);
    shared.registerSharedChartEditing();
    setValue(peer, 919);
    peer.editor.exec({ type: 'DuplicateSlide', id: peer.editor.doc.elements[peer.data.chartId].parent });
    peer.editor.exec({ type: 'RemoveElement', id: peer.data.chartId });
    assert.equal(messages.length, 4, '加载迁移本身不消耗协同序号');
    assert.equal(messages[1].patches[0].path[2], 'edit-addresses', '新语义字段之前必须声明原地址');
    assert.deepEqual(network.errors, []);
    context.freshProcess('announcements-receive', { messages });
  } finally { release(peer); }
}

export async function receiveLegacyMigrationAnnouncements(context, { messages }) {
  const { basic, shared, assert } = context, peer = await openLegacy(context, 'b');
  try {
    const network = bind(context, peer, 'b', () => {});
    setValue(peer, 220);
    network.receive(messages[3]); network.receive(messages[0]); network.receive(messages[2]);
    assert.ok(peer.binding.checkpoint().deferred.length > 0, '独立对端确实遇到尚未安装的迁移声明');
    network.receive(messages[1]); network.receive(messages[1]);
    assert.deepEqual(network.errors, []);
    assert.equal(peer.binding.checkpoint().deferred.length, 0, '声明到达后按原序消费后续复制和删除');
    await assert.rejects(peer.editor.save(), /chart-shared/, '未加载共享实现时保存明确拒绝遗漏文档数据');
    shared.registerSharedChartEditing();
    assert.deepEqual(values(basic, peer), [919], '独立对端迟加载后读取幸存框架上的最新值');
    await peer.editor.save();
  } finally { release(peer); }
}

export async function runLegacyMigrationTransportLimit(context) {
  const { edit, shared, assert } = context, peer = await openLegacy(context, 'a'), messages = [];
  try {
    const network = bind(context, peer, 'a', message => messages.push(message));
    setValue(peer, 110);
    shared.registerSharedChartEditing();
    const snapshot = () => JSON.stringify({ ovr: peer.editor.doc.elements[peer.data.chartId].ovr,
      identity: peer.editor.doc.identity, history: [peer.editor.history.undoCount, peer.editor.history.redoCount],
      dirty: peer.editor.isDirty(), checkpoint: peer.binding.checkpoint() });
    const before = snapshot(), frames = [];
    peer.editor.subscribeRecovery(frame => frames.push(frame));
    assert.throws(() => peer.editor.transaction(tx => {
      for (let index = 0; index < edit.MAX_PATCHES_PER_TRANSACTION; index++) {
        tx.exec({ type: 'SetName', id: peer.data.chartId, name: `预算边界 ${index}` });
      }
    }, '迁移元数据也占消息预算'), /不能超过/);
    assert.equal(snapshot(), before, '传输预算不足时字段、历史、身份和协同时钟都回滚');
    assert.equal(frames.length, 0, '失败事务不生成恢复帧');
    assert.equal(messages.length, 1, '失败事务不发送无效消息');
    setValue(peer, 919);
    assert.equal(messages[1].patches[0].path[2], 'edit-addresses', '失败不能消耗下一次声明的机会');
    assert.deepEqual(network.errors, []);
  } finally { release(peer); }
}

export async function runLegacyMigrationRecoveryLimit(context) {
  const { edit, shared, assert } = context, peer = await openLegacy(context);
  try {
    setValue(peer, 110);
    shared.registerSharedChartEditing();
    const frames = [], before = JSON.stringify(peer.editor.doc.elements[peer.data.chartId].ovr);
    const undoCount = peer.editor.history.undoCount;
    peer.editor.subscribeRecovery(frame => frames.push(frame));
    assert.throws(() => peer.editor.transaction(tx => {
      for (let index = 0; index < edit.MAX_PATCHES_PER_TRANSACTION; index++) {
        tx.exec({ type: 'SetName', id: peer.data.chartId, name: `恢复预算 ${index}` });
      }
    }, '仅恢复日志也预检预算'), /不能超过/);
    assert.equal(JSON.stringify(peer.editor.doc.elements[peer.data.chartId].ovr), before);
    assert.equal(peer.editor.history.undoCount, undoCount);
    assert.equal(frames.length, 0);
    setValue(peer, 919);
    assert.equal(frames[0].patches[0].path[2], 'edit-addresses');
  } finally { release(peer); }
}

export async function runLegacyMigrationLateFirst(context) {
  const { shared, basic, assert } = context, sender = await openLegacy(context, 'a'), messages = [];
  try { bind(context, sender, 'a', message => messages.push(message)); setValue(sender, 111); }
  finally { release(sender); }
  const peer = await openLegacy(context, 'b');
  try {
    const network = bind(context, peer, 'b', () => {});
    shared.registerSharedChartEditing();
    assert.equal(peer.editor.isDirty(), false);
    network.receive(messages[0]);
    assert.deepEqual(network.errors, []);
    assert.equal(peer.editor.doc.elements[peer.data.chartId].ovr.extensions?.['chart-data'], undefined,
      '共享入口已经加载时，首笔迟到旧地址也自动迁移');
    peer.editor.exec({ type: 'DuplicateSlide', id: peer.editor.doc.elements[peer.data.chartId].parent });
    assert.deepEqual(values(basic, peer), [111, 111]);
    await peer.editor.save();
  } finally { release(peer); }
}

export async function runLegacyMigrationEarlyRecovery(context) {
  const { core, edit, shared, assert, input } = context, peer = await openLegacy(context), original = [];
  try {
    peer.editor.subscribeRecovery(frame => original.push(frame));
    setValue(peer, 110);
    peer.editor.dispose();
    shared.registerSharedChartEditing();
    const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const editor = new edit.Editor(edit.createDoc(presentation, { idPrefix: peer.editor.doc.identity.prefix }),
      { recoveryFrames: original });
    const frames = [...original];
    try {
      editor.subscribeRecovery(frame => frames.push(frame));
      editor.select({ kind: 'elements', ids: [peer.data.chartId], enteredGroup: null });
      assert.equal(frames.at(-1).source, 'transaction', '首次选择事件补入构造期间产生的地址声明');
      assert.equal(frames.at(-1).patches[0].path[2], 'edit-addresses');
      context.freshProcess('early-recovery-resume', { frames, chartId: peer.data.chartId,
        idPrefix: peer.editor.doc.identity.prefix });
    } finally { editor.dispose(); edit.disposeDoc(editor.doc); presentation.dispose(); }
  } finally { release(peer); }
}

export async function resumeLegacyMigrationEarlyRecovery(context, { frames, chartId, idPrefix }) {
  const { core, edit, basic, shared, assert, input } = context;
  const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(presentation, { idPrefix }), { recoveryFrames: frames });
  try {
    assert.equal(editor.doc.elements[chartId].ovr.extensions?.['chart-data'], undefined);
    shared.registerSharedChartEditing();
    assert.equal(basic.queryChartData(editor.doc, chartId).series[0].points[0].value, 110,
      '新进程仅依赖落盘日志恢复迁移后的值');
    await editor.save();
  } finally { editor.dispose(); edit.disposeDoc(editor.doc); presentation.dispose(); }
}
