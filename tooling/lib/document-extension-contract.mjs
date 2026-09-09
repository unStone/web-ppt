export async function testDocumentExtensions({ core, edit, input, assert }) {
  const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const makeDoc = () => edit.createDoc(presentation, { idPrefix: 'document-protocol-' });
  const namespace = 'protocol-unloaded';
  const leaf = (value, tail = ['resource', 'value']) => ({ op: 'set', origin: 'peer',
    path: ['document', 'extensions', namespace, ...tail], value });
  const invalid = [null, false, 1, [], new Date(0), { [namespace]: null }, { [namespace]: [] },
    { [namespace]: { resource: undefined } }, { [namespace]: { resource: NaN } },
    { [namespace]: { resource: new Uint8Array(1) } }, { [namespace]: { constructor: 1 } },
    { 'Invalid namespace': { resource: 1 } }, { constructor: { resource: 1 } }, { prototype: { resource: 1 } }];
  const cyclic = {}; cyclic.self = cyclic;
  invalid.push({ [namespace]: cyclic });
  const accessor = Object.defineProperty({}, 'resource', { enumerable: true,
    get: () => { throw new Error('不应执行访问器'); } });
  invalid.push({ [namespace]: accessor });
  invalid.push({ [namespace]: Object.defineProperty({}, 'hidden', { value: 1 }) });
  invalid.push({ [namespace]: { [Symbol('hidden')]: 1 } });
  const reused = { value: 1 };
  invalid.push({ [namespace]: { first: reused, second: reused } });
  let deep = 1;
  for (let i = 0; i < 17; i++) deep = { next: deep };
  invalid.push({ [namespace]: deep });
  for (const extensions of invalid) {
    const doc = makeDoc(); doc.extensions = extensions;
    assert.throws(() => edit.validateEditDoc(doc), /文档扩展/, '会话入口拒绝不能由叶补丁表示或完整序列化的文档扩展');
  }

  const editor = new edit.Editor(makeDoc()), recovery = [], events = [];
  editor.subscribeRecovery(frame => recovery.push(frame));
  editor.subscribe(change => events.push(change));
  for (const key of ['constructor', 'prototype', '__proto__']) {
    assert.throws(() => editor.applyExternalPatches([{ ...leaf(1), path: ['document', 'extensions', key, 'value'] }]),
      /扩展/, '文档扩展命名空间也不能使用保留属性');
  }
  const valid = [null, false, 0, 1.5, '', 'text'];
  editor.applyExternalPatches(valid.map((value, index) => leaf(value, ['resource', `v${index}`])));
  assert.deepEqual(Object.values(editor.doc.extensions[namespace].resource), valid);
  assert.doesNotThrow(() => edit.validateEditDoc(editor.doc));
  await assert.rejects(editor.save(), /protocol-unloaded/, '未加载的文档状态必须保留且阻止静默丢弃');
  const restored = new edit.Editor(makeDoc(), { recoveryFrames: recovery });
  assert.deepEqual(restored.doc.extensions, editor.doc.extensions, '未加载协议的冷恢复保留所有标量');
  restored.dispose();
  const before = JSON.stringify(editor.doc.extensions), eventCount = events.length, frameCount = recovery.length;
  assert.throws(() => editor.applyExternalPatches([leaf(88), leaf(Infinity)]), /扩展/);
  assert.equal(JSON.stringify(editor.doc.extensions), before, '后续无效补丁使整个文档批次保持原样');
  assert.equal(events.length, eventCount);
  assert.equal(recovery.length, frameCount);

  // 结构暂存与普通字段写入必须遵守同一叶协议，失败不安装页面或覆盖。
  const source = new edit.Editor(makeDoc()), outgoing = [];
  let identity;
  source.subscribePatches(event => { outgoing.push(...event.patches); identity = event.identity; });
  source.exec({ type: 'DuplicateSlide', id: source.doc.slideOrder[0] });
  const slides = [...editor.doc.slideOrder];
  assert.throws(() => editor.applyExternalPatches([...outgoing, leaf(99), leaf({ invalid: true })]), /扩展/);
  assert.deepEqual(editor.doc.slideOrder, slides);
  assert.equal(JSON.stringify(editor.doc.extensions), before);
  editor.applyExternalPatches([...outgoing, leaf(99)], { identity });
  assert.equal(editor.doc.slideOrder.length, slides.length + 1);
  assert.equal(editor.doc.extensions[namespace].resource.value, 99, '合法结构与扩展叶在同一批次提交');
  const withStructure = new edit.Editor(makeDoc(), { recoveryFrames: recovery });
  assert.deepEqual(withStructure.doc.extensions, editor.doc.extensions);
  assert.deepEqual(withStructure.doc.slideOrder, editor.doc.slideOrder, '混合结构批次在未加载领域扩展时也能冷恢复');
  withStructure.dispose();
  source.dispose();

  const recoveredDoc = makeDoc(), base = JSON.stringify(recoveredDoc.extensions);
  const corrupted = structuredClone(recovery);
  corrupted[0].patches.push(leaf({ invalid: true }));
  assert.throws(() => new edit.Editor(recoveredDoc, { recoveryFrames: corrupted }), /扩展/);
  assert.equal(JSON.stringify(recoveredDoc.extensions), base, '无效恢复帧不留下前序有效叶');

  const second = new edit.Editor(editor.doc);
  const pending = globalThis[Symbol.for('@web-ppt/edit-core/extensions-listeners/v1')].pending;
  editor.dispose();
  assert.equal(pending.get(namespace)?.size, 1, '一个会话释放后仍保留同文档的其他会话监听');
  second.dispose();
  assert.equal(pending.has(namespace), false, '最后一个会话释放后移除等待注册的命名空间，不能无限积累空集合');
  const invalidSave = new edit.Editor(makeDoc());
  invalidSave.doc.extensions = { [namespace]: accessor };
  await assert.rejects(invalidSave.save(), /文档扩展/, '保存入口也拒绝后续注入的不可序列化容器且不执行访问器');
  invalidSave.dispose();
  presentation.dispose();
}
