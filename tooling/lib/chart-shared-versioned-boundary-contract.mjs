import { openLegacy, peers, release, setValue, values } from './chart-shared-legacy-migration-contract.mjs';

export async function runVersionedChartBinding(context) {
  const { assert, collab, migration } = context;
  const a = await openLegacy(context, 'a'), b = await openLegacy(context, 'b'), errors = [];
  let sent;
  const options = { documentId: 'versioned-binding', replicaId: 'a', replicaSlot: 0,
    provider: { send(message) { sent = structuredClone(message); }, subscribe() { return () => {}; } },
    onError: error => errors.push(error) };
  try {
    a.binding = collab.bindCollaboration(a.editor, options);
    assert.throws(() => migration.bindCollaboration(a.editor, options), /绑定|会话/,
      '默认与可选入口共享同一会话，不能绕过唯一绑定约束');
    setValue(a, 111);
    const first = sent, key = JSON.stringify(first.patches.find(patch => patch.value === 111).path);
    b.binding = migration.bindCollaboration(b.editor, { ...options, replicaId: 'b', replicaSlot: 1,
      provider: { send() {}, subscribe(listener) { listener(first); return () => {}; } } });
    assert.deepEqual(b.binding.checkpoint().extensionOperations.find(([candidate]) => candidate === key)?.[1],
      { op: 'set', value: 111 }, 'provider 同步首批消息不能早于原操作记录器');
    const before = a.binding.checkpoint(); a.binding.dispose();
    a.binding = migration.bindCollaboration(a.editor, options);
    const restored = a.binding.checkpoint();
    assert.deepEqual(restored.registers, before.registers, '默认入口切换到可选入口沿用原寄存器');
    assert.deepEqual(restored.extensionOperations, [], '启用前的字段证据保持未知');
    setValue(a, 222);
    assert.equal(sent.sequence, first.sequence + 1, '切换入口不能重开消息序号');
    assert.deepEqual(a.binding.checkpoint().extensionOperations.find(([candidate]) => candidate === key)?.[1], { op: 'set', value: 222 });
    assert.deepEqual(errors, []);
  } finally { release(a); release(b); }
}

export async function runVersionedChartDeferred(context) {
  const { assert, basic } = context;
  const network = await peers({ ...context, collab: context.migration }, 'versioned-deferred');
  const [a, b] = network.result;
  try {
    setValue(a, 111); setValue(a, 222);
    const [first, second] = network.take('b');
    const path = first.patches.find(patch => patch.value === 111).path, key = JSON.stringify(path);
    const invalid = { ...second, patches: second.patches.map(patch => JSON.stringify(patch.path) === key
      ? { ...patch, value: {} } : patch) };
    network.deliver('b', invalid);
    assert.ok(b.binding.checkpoint().deferred.length > 0, '缺前序时先保存原消息');
    network.deliver('b', first);
    assert.deepEqual(values(basic, b), [111], '坏的延迟组不能回滚同批合法前序');
    const checkpoint = b.binding.checkpoint();
    assert.equal(checkpoint.deferred.length, 0, '无效原操作只隔离自己的延迟组');
    assert.deepEqual(checkpoint.extensionOperations.find(([candidate]) => candidate === key)?.[1], { op: 'set', value: 111 });
    assert.equal(network.errors.length, 1); network.errors.length = 0;
    network.deliver('b', first);
    setValue(a, 333); network.take('b').forEach(message => network.deliver('b', message));
    assert.deepEqual(values(basic, b), [333], '坏消息隔离后后续合法消息继续推进');
    assert.deepEqual(network.errors, []);
  } finally { network.result.forEach(release); }
}

export async function runVersionedChartOpaqueRegister(context) {
  const { assert, core, edit, shared, migration, input } = context;
  const documentId = 'versioned-opaque-register';
  const network = await peers({ ...context, collab: migration }, documentId);
  const [a] = network.result;
  let cold, presentation, binding;
  try {
    setValue(a, 919);
    const [message] = network.take('b');
    shared.registerSharedChartEditing();
    const checkpoint = a.binding.checkpoint();
    const key = JSON.stringify(['elements', a.data.chartId, 'ovr', 'extensions', 'chart-data', 'categories', 'x'.repeat(1024), 'id']);
    checkpoint.registers.push([key, { stamp: message.stamp, kind: 'field' }]);
    delete checkpoint.extensionOperations;
    presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    cold = new edit.Editor(edit.createDoc(presentation, { idPrefix: a.editor.doc.identity.prefix }), { recoveryFrames: a.frames });
    binding = migration.bindCollaboration(cold, { documentId, replicaId: 'a', replicaSlot: 0, checkpoint,
      provider: { send() {}, subscribe() { return () => {}; } } });
    const restored = binding.checkpoint();
    assert.deepEqual(restored.registers.find(([candidate]) => candidate === key), checkpoint.registers.at(-1),
      '旧 checkpoint 的透明键在没有原操作证据时保留，不能因为新地址规则而使整个 checkpoint 失败');
    assert.deepEqual(restored.extensionOperations, [], '没有原操作的旧检查点保持未知，不能从现存模型补造证据');
  } finally {
    binding?.dispose(); if (cold) { cold.dispose(); edit.disposeDoc(cold.doc); } presentation?.dispose();
    network.result.forEach(release);
  }
}
