import { openLegacy, peers, release, setValue, values } from './chart-shared-legacy-migration-contract.mjs';

// 核心只执行已裁决的纯数据凭据；它不依赖 collab 会话，也不自行创造字段时钟。
export async function runExtensionMigrationReceipt(context) {
  const { assert, edit, core, shared, input } = context, peer = await openLegacy(context), frames = [];
  const editor = peer.editor, ids = Object.keys(editor.doc.elements).slice(0, 2);
  const target = ['document', 'extensions', 'chart-shared', peer.data.binding.chartPart, 'dataset', 'series', 's0', 'points', 'c0'];
  const value = doc => doc.extensions?.['chart-shared']?.[peer.data.binding.chartPart]?.dataset?.series?.s0?.points?.c0?.value;
  const source = id => ['elements', id, 'ovr', 'extensions', 'migration-source', 'value'];
  const routes = ids.map(id => ({ source: [id, 'migration-source'],
    address: JSON.stringify({ target, identities: {}, merge: 'equal' }) }));
  const receipt = { version: 1, routes, inputs: ids.map((id, index) => ({ path: source(id), op: 'set',
    value: index ? 777 : 111, stamp: { clock: index + 1, replicaId: 'old-client' } })), winners: [1] };
  const patch = value => ({ op: 'set', origin: 'migration-result',
    path: ['document', 'extensions', 'edit-migrations', JSON.stringify(target)], value: JSON.stringify(value) });
  editor.subscribeRecovery(frame => frames.push(frame));
  try {
    editor.applyExternalPatches(ids.map((id, index) => ({ op: 'set', origin: 'old-client', path: source(id), value: index ? 777 : 111 })));
    editor.markSaved();
    shared.registerSharedChartEditing();
    const state = () => JSON.stringify({ elements: editor.doc.elements, extensions: editor.doc.extensions,
      identity: editor.doc.identity, dirty: editor.isDirty(), history: [editor.history.undoCount, editor.history.redoCount], frames: frames.length });
    const before = state(), bad = structuredClone(receipt); bad.inputs[1].value = 'bad';
    assert.throws(() => editor.applyExternalPatches([patch(bad)]), /数值|数|有限/);
    assert.equal(state(), before, '领域校验失败不能清除来源、写入目标或消耗恢复帧');
    const omitted = { ...receipt, inputs: [receipt.inputs[1]], winners: [0] };
    assert.throws(() => editor.applyExternalPatches([patch(omitted)]), /参与来源字段/);
    assert.equal(state(), before, '漏掉一个旧来源的凭据不能清除未覆盖的数据');
    assert.throws(() => editor.applyExternalPatches([patch(receipt),
      { op: 'set', origin: 'old-client', path: source(ids[0]), value: 'bad' }]), /数值|数|有限/);
    assert.equal(state(), before, '凭据之后的字段失败也不能泄漏已经暂存的清源与赢家');
    const identity = structuredClone(editor.doc.identity), history = editor.history.undoCount;
    editor.applyExternalPatches([patch(receipt)]);
    assert.equal(value(editor.doc), 777);
    assert.ok(ids.every(id => editor.doc.elements[id].ovr.extensions?.['migration-source'] === undefined));
    assert.deepEqual(editor.doc.identity, identity, '纯地址迁移不推进字段时钟或消息序号');
    assert.equal(editor.history.undoCount, history, '自动迁移不新增用户历史');
    assert.equal(editor.isDirty(), false, '迁移保留保存状态');
    const canonical = edit.canonicalExtensionPatch(editor.doc, { op: 'set', origin: 'late', path: source(ids[0]), value: 888 });
    assert.deepEqual(canonical.path, [...target, 'value'], '旧字段与历史继续沿不可变地址寻址');
    const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const cold = new edit.Editor(edit.createDoc(presentation, { idPrefix: editor.doc.identity.prefix }), { recoveryFrames: frames });
    try {
      assert.equal(value(cold.doc), 777, '无协同绑定的冷恢复执行同一纯数据凭据');
      assert.deepEqual(cold.doc.identity, identity);
      assert.equal(cold.isDirty(), false);
      await cold.save();
      const key = JSON.stringify(target), stored = cold.doc.extensions['edit-migrations'][key];
      cold.doc.extensions['edit-migrations'][key] = JSON.stringify({ ...receipt, winners: [99_999] });
      try {
        await assert.rejects(() => cold.save(), /迁移凭据/, '保存入口不能放过裸模型中损坏的已知迁移协议');
        assert.throws(() => { const unexpected = new edit.Editor(cold.doc); unexpected.dispose(); }, /迁移凭据/);
      } finally { cold.doc.extensions['edit-migrations'][key] = stored; }
    } finally { cold.dispose(); edit.disposeDoc(cold.doc); presentation.dispose(); }
    editor.applyExternalPatches([canonical]);
    editor.applyExternalPatches([patch(receipt)]);
    assert.equal(value(editor.doc), 888, '重复凭据不能重置迁移后发生的普通编辑');
    const deleted = { ...receipt, inputs: [...receipt.inputs,
      { path: [...target, 'value'], op: 'del', stamp: { clock: 3, replicaId: 'old-client' } }], winners: [2] };
    editor.applyExternalPatches([patch(deleted)]);
    assert.equal(value(editor.doc), undefined, '删除墓碑胜出时清除目标覆盖，不因来源仍有旧值而复活');
    assert.deepEqual(editor.doc.identity, identity);
    const deletedSource = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const restored = new edit.Editor(edit.createDoc(deletedSource, { idPrefix: editor.doc.identity.prefix }), { recoveryFrames: frames });
    try {
      assert.equal(value(restored.doc), undefined, '同一路由更新凭据后，冷恢复必须重放最后的删除赢家');
      assert.ok(ids.every(id => restored.doc.elements[id].ovr.extensions?.['migration-source'] === undefined));
    } finally { restored.dispose(); edit.disposeDoc(restored.doc); deletedSource.dispose(); }
  } finally { release(peer); }
}

export async function runExtensionMigrationTransport(context) {
  const { assert } = context;
  for (const collab of [context.collab, context.migration]) {
    const network = await peers({ ...context, collab }, 'receipt-transport'), [a, b] = network.result;
    try {
      setValue(a, 111);
      const [original] = network.take('b'), target = ['document', 'extensions', 'migration-target', 'data'];
      const receipt = { version: 1, routes: [{ source: [b.data.chartId, 'migration-source'],
        address: JSON.stringify({ target, identities: {}, merge: 'equal' }) }],
      inputs: [{ path: [...target, 'value'], op: 'set', value: 777,
        stamp: collab === context.migration ? { ...original.stamp, clock: original.stamp.clock + 1 } : original.stamp }], winners: [0] };
      const snapshot = () => JSON.stringify({ elements: b.editor.doc.elements, extensions: b.editor.doc.extensions,
        identity: b.editor.doc.identity, dirty: b.editor.isDirty(), frames: b.frames, checkpoint: b.binding.checkpoint() });
      const before = snapshot();
      network.deliver('b', { ...original, patches: [{ op: 'set', origin: 'migration',
        path: ['document', 'extensions', 'edit-migrations', JSON.stringify(target)], value: JSON.stringify(receipt) }] });
      assert.equal(network.errors.length, 1, '默认入口拒绝直接凭据；可选入口拒绝超出运输因果水位的原版本');
      assert.match(String(network.errors[0]), /迁移凭据.*裁决/);
      assert.equal(snapshot(), before, '未裁决远端凭据不得修改模型、寄存器、恢复帧或消费消息序号');
      network.deliver('b', { ...original, patches: [{ op: 'set', origin: 'alias',
        path: ['document', 'extensions', 'edit-addresses', b.data.chartId, 'migration-alias'],
        value: JSON.stringify({ target: ['document', 'extensions', 'edit-migrations', JSON.stringify(target)], identities: {} }) }] });
      assert.equal(network.errors.length, 2, '地址不能将普通旧字段伪装成核心保留的迁移凭据');
      assert.match(String(network.errors[1]), /地址映射/);
      assert.equal(snapshot(), before, '指向协议元数据的地址也必须在任何落模与序号消费前拒绝');
      network.errors.length = 0;
      network.deliver('b', original);
      assert.equal(b.binding.checkpoint().seen.length, 1);
      assert.deepEqual(network.errors, [], '拒绝凭据后原序号的合法消息仍然可接收');
    } finally { network.result.forEach(release); }
  }
}

export async function runExtensionMigrationPaths(context) {
  const { assert } = context;
  for (const scenario of ['ancestor-first', 'child-first', 'scalar-parent', 'container-leaf']) {
    const peer = await openLegacy(context), editor = peer.editor, ids = Object.keys(editor.doc.elements).slice(0, 2);
    const target = ['document', 'extensions', 'migration-target', 'data'];
    const source = (id, ...path) => ['elements', id, 'ovr', 'extensions', 'migration-source', ...path];
    const field = (path, value) => ({ op: 'set', origin: 'legacy', path, value });
    const inputs = scenario.endsWith('first')
      ? [field(source(ids[0], 'a'), 1), field(source(ids[1], 'a', 'b'), 2)]
      : [field(source(ids[0], ...(scenario === 'scalar-parent' ? ['a', 'b'] : ['a'])), 2)];
    try {
      editor.applyExternalPatches([...inputs, ...(scenario === 'scalar-parent' ? [field([...target, 'a'], 1)]
        : scenario === 'container-leaf' ? [field([...target, 'a', 'b'], 1)] : [])]);
      editor.markSaved();
      const frames = []; editor.subscribeRecovery(frame => frames.push(frame));
      const snapshot = () => JSON.stringify({ elements: editor.doc.elements, extensions: editor.doc.extensions,
        identity: editor.doc.identity, dirty: editor.isDirty(), frames, history: editor.history.undoCount });
      const before = snapshot(), receipt = { version: 1,
        routes: ids.slice(0, inputs.length).map(id => ({ source: [id, 'migration-source'],
          address: JSON.stringify({ target, identities: {}, merge: 'equal' }) })),
        inputs: inputs.map(({ origin, ...input }) => input),
        winners: scenario === 'child-first' ? [1, 0] : inputs.map((_, index) => index) };
      assert.throws(() => editor.applyExternalPatches([{ op: 'set', origin: 'migration',
        path: ['document', 'extensions', 'edit-migrations', JSON.stringify(target)], value: JSON.stringify(receipt) }]),
      /迁移.*(冲突|容器)/, `${scenario} 必须拒绝不能同时物化的赢家，不能成功后丢掉来源数据`);
      assert.equal(snapshot(), before, `${scenario} 失败必须保持模型、历史、保存状态和恢复日志`);
    } finally { release(peer); }
  }
}

export async function runExtensionMigrationDeferred(context) {
  const { assert, core, edit, basic, input } = context;
  for (const collab of [context.collab, context.migration]) {
    const network = await peers({ ...context, collab }, 'receipt-deferred'), [a, b] = network.result;
    let presentation, editor, binding;
    try {
      setValue(a, 111); setValue(a, 222);
      const [first, second] = network.take('b');
      network.deliver('b', second);
      const checkpoint = b.binding.checkpoint(), receipt = { op: 'set', origin: 'migration',
        path: ['document', 'extensions', 'edit-migrations', 'legacy-result'], value: '{}' };
      const message = { ...second, patches: [receipt] };
      checkpoint.deferred = [{ message, patch: receipt, ordinal: 0 }];
      presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
      editor = new edit.Editor(edit.createDoc(presentation, { idPrefix: b.editor.doc.identity.prefix }), { recoveryFrames: b.frames });
      let receive; const errors = [];
      binding = collab.bindCollaboration(editor, { documentId: 'receipt-deferred', replicaId: 'b', replicaSlot: 1, checkpoint,
        provider: { send() {}, subscribe(listener) { receive = listener; return () => {}; } }, onError: error => errors.push(error) });
      receive(first);
      assert.deepEqual(values(basic, { ...b, editor }), [111], '旧检查点中的坏延迟凭据不能回滚刚补齐的合法前序');
      const after = binding.checkpoint();
      assert.equal(after.deferred.length, 0);
      assert.deepEqual(after.seen, [{ replicaId: 'a', contiguous: 2, sparse: [] }], '保留已见坏消息，提交前序后只隔离坏延迟体');
      assert.equal(errors.length, 1); assert.match(String(errors[0]), /迁移凭据.*裁决/);
      assert.ok(!after.registers.some(([key]) => key.includes('edit-migrations')));
      assert.ok(!after.extensionOperations?.some(([key]) => key.includes('edit-migrations')));
      receive(first); assert.equal(errors.length, 1, '重复前序不会重复报告已隔离消息');
      setValue(a, 333); network.take('b').forEach(receive);
      assert.deepEqual(values(basic, { ...b, editor }), [333], '坏组隔离后后续合法消息继续落模');
      assert.equal(errors.length, 1);
    } finally {
      binding?.dispose(); if (editor) { editor.dispose(); edit.disposeDoc(editor.doc); } presentation?.dispose();
      network.result.forEach(release);
    }
  }
}
