import { peers, release, setValue } from './chart-shared-legacy-migration-contract.mjs';

const registers = checkpoint => new Map(checkpoint.registers.map(([key, register]) => {
  const operation = checkpoint.extensionOperations?.find(([candidate]) => candidate === key)?.[1];
  return [key, { ...register, ...(operation ? { operation } : {}) }];
}));

// 迁移不能把「元素已删除」误认为该元素上的每个字段都被 del；版本须携带原操作。
export async function runVersionedChartRegisters(context) {
  const { assert } = context, network = await peers({ ...context, collab: context.migration }, 'versioned-chart-registers');
  const [a, b] = network.result;
  try {
    setValue(a, 919);
    const [set] = network.take('b'), path = set.patches.find(patch => patch.value === 919).path;
    const key = JSON.stringify(path);
    const field = peer => registers(peer.binding.checkpoint()).get(key);
    assert.deepEqual(field(a), { stamp: set.stamp, kind: 'field', operation: { op: 'set', value: 919 } },
      '本地字段版本保留原 set 值，不能仅从当前模型猜测操作');
    network.deliver('b', set);
    assert.deepEqual(field(b), field(a), '远端原操作与本地 checkpoint 一致');
    setValue(a, 777);
    const [valid] = network.take('b'), beforeFailure = b.binding.checkpoint();
    const invalid = { ...valid, patches: valid.patches.map(patch => JSON.stringify(patch.path) === key
      ? { ...patch, value: '不是图表数值' } : patch) };
    network.deliver('b', invalid);
    assert.equal(network.errors.length, 1, '领域无效的标量必须拒绝整批'); network.errors.length = 0;
    assert.deepEqual(b.binding.checkpoint(), beforeFailure, '失败批次同时回滚时钟、消息水位与原操作证据');
    network.deliver('b', valid);
    a.editor.undo();
    const [undo] = network.take('b');
    // 当前图表命令的撤销写回原生值；旧 provider 也允许用 del 撤销稀疏覆盖。
    const removed = { ...undo, patches: undo.patches.map(patch => JSON.stringify(patch.path) === key
      ? { op: 'del', path: patch.path, origin: patch.origin } : patch) };
    network.deliver('b', removed);
    assert.deepEqual(field(b), { stamp: removed.stamp, kind: 'field', operation: { op: 'del' } },
      '旧消息删除稀疏覆盖必须持久化 del 墓碑及原时钟');
    network.deliver('b', set);
    assert.equal(field(b).operation.op, 'del', '迟到重复 set 不能改写已获胜的墓碑');
    a.editor.redo();
    const [restored] = network.take('b');
    network.deliver('b', restored);
    const proof = structuredClone(field(b));
    a.editor.exec({ type: 'RemoveSlide', id: a.editor.doc.elements[a.data.chartId].parent });
    network.take('b').forEach(message => network.deliver('b', message));
    assert.equal(b.editor.doc.elements[b.data.chartId], undefined);
    assert.deepEqual(field(b), proof, '删除所属页面不能把原 set 证据变成字段删除');
    assert.deepEqual(network.errors, []);
    await context.freshProcess('versioned-registers-resume', {
      documentId: 'versioned-chart-registers', checkpoint: b.binding.checkpoint(), frames: b.frames, key, proof,
      idPrefix: b.editor.doc.identity.prefix,
    });
  } finally { network.result.forEach(release); }
}

export async function resumeVersionedChartRegisters(context, payload) {
  const { assert, core, edit, migration: collab, input } = context;
  const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(presentation, { idPrefix: payload.idPrefix }), { recoveryFrames: payload.frames });
  const options = { documentId: payload.documentId, replicaId: 'b', replicaSlot: 1,
    provider: { send() {}, subscribe() { return () => {}; } } };
  let binding;
  try {
    const before = structuredClone(editor.doc.identity);
    let getterReads = 0;
    for (const operation of [{ op: 'remove' }, { op: 'set', value: {} }, { op: 'set', value: NaN },
      { op: 'del', value: 919 }, { op: 'set', value: 'x'.repeat(1_000_001) }, Object.create({ op: 'del' }),
      { op: 'set', get value() { getterReads++; return 919; } }, { op: 'del', [Symbol('extra')]: true },
      Object.defineProperty({ op: 'del' }, 'extra', { value: 1 })]) {
      const checkpoint = structuredClone(payload.checkpoint);
      checkpoint.extensionOperations.find(([key]) => key === payload.key)[1] = operation;
      assert.throws(() => collab.bindCollaboration(editor, { ...options, checkpoint }), /原操作/);
      assert.deepEqual(editor.doc.identity, before, '无效原操作证据在绑定前拒绝并还原身份');
    }
    assert.equal(getterReads, 0, '校验原操作不能执行调用者的访问器');
    binding = collab.bindCollaboration(editor, { ...options, checkpoint: payload.checkpoint });
    assert.deepEqual(registers(binding.checkpoint()).get(payload.key), payload.proof,
      '新进程在来源元素不存在时仍保留精确的原操作与时钟');
    binding.dispose();
    const stale = structuredClone(payload.checkpoint);
    stale.extensionOperations.find(([key]) => key === payload.key)[1] = { op: 'set', value: -123 };
    binding = collab.bindCollaboration(editor, { ...options, checkpoint: stale });
    assert.deepEqual(registers(binding.checkpoint()).get(payload.key), payload.proof,
      '同一会话重新绑定沿用现有版本，不能重新注入调用者传来的旧 checkpoint 证据');
  } finally { binding?.dispose(); editor.dispose(); edit.disposeDoc(editor.doc); presentation.dispose(); }
}

export async function runVersionedChartRegisterRemap(context) {
  const { assert, edit, shared } = context, network = await peers({ ...context, collab: context.migration }, 'versioned-register-remap');
  const [a] = network.result;
  try {
    const id = a.api.addCategory(a.data.chartId, '新增');
    a.api.setSeriesName(a.data.chartId, a.data.series[0].id, id);
    const before = registers(a.binding.checkpoint());
    shared.registerSharedChartEditing();
    const after = registers(a.binding.checkpoint());
    let changedReferences = 0;
    for (const [key, register] of before) {
      if (!register.operation) continue;
      const original = { ...register.operation, path: JSON.parse(key), origin: 'proof' };
      const mapped = edit.canonicalExtensionPatch(a.editor.doc, original);
      const migrated = after.get(JSON.stringify(mapped.path));
      const operation = mapped.op === 'set' ? { op: 'set', value: mapped.value } : { op: 'del' };
      assert.deepEqual(migrated, { ...register, operation }, '规范地址与原操作中的身份引用必须同时映射');
      if (original.value !== mapped.value) changedReferences++;
    }
    assert.ok(changedReferences > 0, '新增类别必须实际覆盖身份引用重映射');
    const data = shared.queryChartData(a.editor.doc, a.data.chartId);
    shared.createChartDataEditor(a.editor).setValue(data.chartId, data.series[0].id, data.series[0].points[0].id, 778);
    const snapshot = a.binding.checkpoint();
    const exported = snapshot.extensionOperations.find(([key, operation]) => key.startsWith('["document",') && operation.value === 778);
    assert.ok(exported, '共享地址也要验证 checkpoint 证据隔离');
    exported[1].value = -555;
    assert.equal(registers(a.binding.checkpoint()).get(exported[0]).operation.value, 778,
      '修改外部 checkpoint 快照不能反向篡改原时钟对应的操作证据');
    assert.deepEqual(network.errors, []);
  } finally { network.result.forEach(release); }
}
