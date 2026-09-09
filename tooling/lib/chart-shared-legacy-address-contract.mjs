import { openLegacy, release, setValue } from './chart-shared-legacy-migration-contract.mjs';

export async function runLegacyMigrationAddresses(context) {
  const { core, edit, assert, input } = context, peer = await openLegacy(context);
  const source = peer.data.chartId;
  const target = ['document', 'extensions', 'migration-test', 'resource', 'dataset'];
  const declaration = (id = source, destination = target) => ({ op: 'set', origin: 'migration-test',
    path: ['document', 'extensions', 'edit-addresses', id, 'chart-data'],
    value: JSON.stringify({ target: destination, identities: {} }) });
  const frames = [], events = [];
  peer.editor.subscribeRecovery(frame => frames.push(frame));
  peer.editor.subscribePatches(event => events.push(event));
  const snapshot = () => JSON.stringify({ extensions: peer.editor.doc.extensions,
    ovr: peer.editor.doc.elements[source].ovr, identity: peer.editor.doc.identity,
    history: [peer.editor.history.undoCount, peer.editor.history.redoCount], dirty: peer.editor.isDirty() });
  const rejects = patches => {
    const before = snapshot(), frameCount = frames.length, eventCount = events.length;
    assert.throws(() => peer.editor.applyExternalPatches(patches));
    assert.equal(snapshot(), before, '失败声明必须保持原字段、历史、身份与时钟原样');
    assert.equal(frames.length, frameCount);
    assert.equal(events.length, eventCount);
  };
  try {
    setValue(peer, 919);
    for (const value of ['{', 'null', '[]', JSON.stringify({ target, identities: { c0: '__proto__' } })]) {
      rejects([{ ...declaration(), value }]);
    }
    for (const namespaces of [1, false, null, 'value', []]) {
      const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
      const doc = edit.createDoc(presentation, { idPrefix: 'invalid-address-' });
      try {
        doc.extensions = { 'edit-addresses': { source: namespaces } };
        assert.throws(() => edit.validateEditDoc(doc), /扩展|地址/, '声明表每个源必须是命名空间容器');
      } finally { edit.disposeDoc(doc); presentation.dispose(); }
    }
    rejects([declaration(), { op: 'set', origin: 'peer',
      path: ['document', 'extensions', 'migration-test', 'bad'], value: {} }]);
    rejects([declaration('missing-a'), declaration('missing-b')]);
    rejects([declaration('missing-a'), declaration('missing-b', [...target, 'series'])]);

    const collision = { op: 'set', origin: 'peer', path: target, value: 33 };
    peer.editor.applyExternalPatches([collision]);
    rejects([declaration()]);
    peer.editor.applyExternalPatches([{ ...collision, op: 'del' }]);
    const ancestor = { ...collision, path: target.slice(0, -1) };
    peer.editor.applyExternalPatches([ancestor]);
    rejects([declaration()]);
    peer.editor.applyExternalPatches([{ ...ancestor, op: 'del' }]);

    const old = structuredClone(peer.editor.doc.elements[source].ovr.extensions['chart-data']);
    peer.editor.applyExternalPatches([declaration()]);
    assert.equal(peer.editor.doc.elements[source].ovr.extensions?.['chart-data'], undefined);
    assert.deepEqual(peer.editor.doc.extensions['migration-test'].resource.dataset, old);
    const installed = snapshot();
    peer.editor.applyExternalPatches([declaration()]);
    assert.equal(snapshot(), installed, '同一声明重复应用不搬移或重写字段');
    rejects([{ ...declaration(), op: 'del' }]);
    rejects([declaration(source, ['document', 'extensions', 'migration-test', 'elsewhere'])]);
  } finally { release(peer); }
}

export async function runLegacyMigrationConstructor(context) {
  const { edit, shared, assert } = context, peer = await openLegacy(context);
  try {
    setValue(peer, 919);
    peer.editor.applyExternalPatches([{ op: 'set', origin: 'conflicting-source',
      path: ['document', 'extensions', 'edit-addresses', 'missing-source', 'chart-data'],
      value: JSON.stringify({ target: ['document', 'extensions', 'chart-shared', peer.data.binding.chartPart, 'dataset'],
        identities: {} }) }]);
    peer.editor.dispose();
    shared.registerSharedChartEditing();
    const store = globalThis[Symbol.for('@web-ppt/edit-core/extensions-listeners/v1')];
    const count = store.active.size;
    for (let attempt = 0; attempt < 3; attempt++) {
      assert.throws(() => new edit.Editor(peer.editor.doc), /来源身份映射不完整/);
      assert.equal(store.active.size, count, '构造失败不残留持有文档的迁移监听器');
      assert.equal(store.documents.get(peer.editor.doc)?.size ?? 0, 0);
    }
  } finally { release(peer); }
}
