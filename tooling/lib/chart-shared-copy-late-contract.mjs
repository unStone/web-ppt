import { peers, release, setValue, views } from './chart-shared-legacy-migration-contract.mjs';

export async function runChartCopyLate(context) {
  for (const deferred of [false, true]) {
    const network = await peers({ ...context, collab: context.migration }, 'versioned-copy-late'), [a, b] = network.result;
    try {
      setValue(a, 111); network.take('b').forEach(message => network.deliver('b', message));
      let gap;
      if (deferred) {
        a.editor.exec({ type: 'SetName', id: a.data.chartId, name: '复制来源' });
        [gap] = network.take('b');
      }
      a.editor.exec({ type: 'DuplicateSlide', id: a.editor.doc.elements[a.data.chartId].parent });
      const [copy] = network.take('b');
      setValue(b, 777);
      context.freshProcess('versioned-copy-late-resume', { frames: b.frames, checkpoint: b.binding.checkpoint(),
        copy, gap, part: a.data.binding.chartPart, copyId: views(context.basic, a)[1].chartId,
        idPrefix: a.editor.doc.identity.prefix });
    } finally { network.result.forEach(release); }
  }
}

export async function resumeChartCopyLate({ assert, core, edit, migration, loadShared, input }, payload) {
  const options = { edit: true, keepPackage: true, lazy: false }, source = await core.parse(input, options);
  const editor = new edit.Editor(edit.createDoc(source, { idPrefix: payload.idPrefix }), { recoveryFrames: payload.frames });
  const errors = [], frames = [...payload.frames]; let receive;
  editor.subscribeRecovery(frame => frames.push(frame));
  const binding = migration.bindCollaboration(editor, { documentId: 'versioned-copy-late', replicaId: 'b', replicaSlot: 1,
    checkpoint: payload.checkpoint, provider: { send() {}, subscribe(listener) { receive = listener; return () => {}; } },
    onError: error => errors.push(error) });
  try {
    const shared = await loadShared(); shared.registerSharedChartEditing();
    const data = doc => shared.listEditableCharts(doc).filter(chart => chart.binding.chartPart === payload.part)
      .map(chart => shared.queryChartData(doc, chart.id));
    const values = doc => data(doc).map(chart => chart.series[0].points[0].value);
    assert.deepEqual(values(editor.doc), [777]);
    receive(payload.copy);
    let expected = 777;
    if (payload.gap) {
      assert.equal(editor.doc.elements[payload.copyId], undefined, '缺前序消息时整批复制仍等待');
      const chart = data(editor.doc)[0];
      shared.createChartDataEditor(editor).setValue(chart.chartId, chart.series[0].id, chart.series[0].points[0].id, 888);
      expected = 888;
      receive(payload.gap);
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(values(editor.doc), [expected, expected], '已迁移接收端须把迟到复制纳入同批原版本裁决');
    const unchanged = JSON.stringify([editor.doc.extensions, binding.checkpoint(), frames]);
    receive(payload.copy);
    assert.equal(JSON.stringify([editor.doc.extensions, binding.checkpoint(), frames]), unchanged);
    const coldSource = await core.parse(input, options);
    const cold = new edit.Editor(edit.createDoc(coldSource, { idPrefix: payload.idPrefix }), { recoveryFrames: frames });
    try { assert.deepEqual(values(cold.doc), [expected, expected]); }
    finally { cold.dispose(); edit.disposeDoc(cold.doc); coldSource.dispose(); }
    const saved = await core.parse(await editor.save(), options), savedDoc = edit.createDoc(saved);
    try { assert.deepEqual(values(savedDoc), [expected, expected], '原生保存重开保留所有共享框架的获胜值'); }
    finally { edit.disposeDoc(savedDoc); saved.dispose(); }
  } finally { binding.dispose(); editor.dispose(); edit.disposeDoc(editor.doc); source.dispose(); }
}
