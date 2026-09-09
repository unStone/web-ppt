import { openLegacy, release, setValue } from './chart-shared-legacy-migration-contract.mjs';

export async function runMigrationRecoveryOrder(context) {
  const { assert, core, edit, input } = context;
  for (const scenario of ['unrelated', 'field-first', 'receipt-first', 'late-journal']) {
    const peer = await openLegacy(context), editor = peer.editor, frames = [];
    const id = peer.data.chartId, target = ['document', 'extensions', 'migration-target', 'data'];
    const path = name => ['elements', id, 'ovr', 'extensions', 'migration-source', name];
    const set = (path, value) => ({ op: 'set', origin: 'legacy', path, value });
    const receipt = (name, value) => set(['document', 'extensions', 'edit-migrations', JSON.stringify(target)],
      JSON.stringify({ version: 1, routes: [{ source: [id, 'migration-source'],
        address: JSON.stringify({ target, identities: {}, merge: 'equal' }) }],
      inputs: [{ path: path(name), op: 'set', value }], winners: [0] }));
    const data = doc => doc.extensions?.['migration-target']?.data;
    try {
      if (scenario === 'late-journal') editor.applyExternalPatches([receipt('value', 777)]);
      editor.subscribeRecovery(frame => frames.push(frame));
      if (scenario === 'unrelated') {
        editor.applyExternalPatches([set([...target, 'foo'], 99)]);
        editor.applyExternalPatches([set(path('foo'), 1)]);
        editor.applyExternalPatches([{ op: 'del', origin: 'legacy', path: path('foo') }, set(path('bar'), 2)]);
        editor.applyExternalPatches([receipt('bar', 2)]);
      } else if (scenario === 'field-first') {
        editor.applyExternalPatches([set(path('value'), 111), receipt('value', 777)]);
      } else if (scenario === 'receipt-first') {
        editor.applyExternalPatches([receipt('value', 777), set(path('value'), 111)]);
      } else editor.applyExternalPatches([set(path('value'), 555), receipt('value', 999)]);
      const expected = scenario === 'unrelated' ? { foo: 99, bar: 2 }
        : { value: scenario === 'receipt-first' ? 111 : scenario === 'late-journal' ? 999 : 777 };
      assert.deepEqual({ ...data(editor.doc) }, expected, `${scenario} 实时执行严格遵守原补丁顺序`);
      const source = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
      const coldDoc = edit.createDoc(source, { idPrefix: editor.doc.identity.prefix });
      let cold;
      try {
        cold = new edit.Editor(coldDoc, { recoveryFrames: frames });
        assert.deepEqual({ ...data(cold.doc) }, expected, `${scenario} 真实日志冷恢复不能提前路由历史字段`);
      } finally { cold?.dispose(); edit.disposeDoc(coldDoc); source.dispose(); }
    } finally { release(peer); }
  }
}

export async function runMigrationResolverDisposal(context) {
  const { assert, edit, shared } = context, peer = await openLegacy(context), calls = [];
  const a = () => { calls.push('a'); return []; }, b = () => { calls.push('b'); return []; };
  const releases = [];
  try {
    setValue(peer, 111);
    releases.push(edit.setExtensionMigrationResolver(peer.editor.doc, a));
    releases.push(edit.setExtensionMigrationResolver(peer.editor.doc, b));
    shared.registerSharedChartEditing();
    const pending = [{ op: 'set', origin: 'legacy', path: ['elements', peer.data.chartId,
      'ovr', 'extensions', 'chart-data', 'series', peer.data.series[0].id, 'points', peer.data.series[0].points[0].id, 'value'], value: 111 }];
    calls.length = 0;
    releases[0](); releases[1]();
    edit.extensionMigrationPatches(peer.editor.doc, pending);
    assert.deepEqual(calls, [], '乱序释放不能恢复已经释放的解析器');
    const first = edit.setExtensionMigrationResolver(peer.editor.doc, a), second = edit.setExtensionMigrationResolver(peer.editor.doc, a);
    releases.push(first, second);
    first(); first();
    edit.extensionMigrationPatches(peer.editor.doc, pending);
    assert.deepEqual(calls, ['a'], '相同函数的两次注册也须按各自实例释放');
    second(); calls.length = 0;
    edit.extensionMigrationPatches(peer.editor.doc, pending);
    assert.deepEqual(calls, []);
  } finally { releases.forEach(release => release()); release(peer); }
}
