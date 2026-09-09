import { peers, release, setValue, views } from './chart-shared-legacy-migration-contract.mjs';

export async function runConflictEvidence(context) {
  const network = await peers({ ...context, collab: context.migration }, 'conflict-evidence'), [a, b] = network.result;
  try {
    a.editor.exec({ type: 'DuplicateSlide', id: a.editor.doc.elements[a.data.chartId].parent });
    a.editor.exec({ type: 'DuplicateSlide', id: a.editor.doc.elements[a.data.chartId].parent });
    const copies = views(context.basic, a).filter(frame => frame.chartId !== a.data.chartId);
    setValue(b, 111); setValue(b, 777); b.editor.undo(); b.editor.undo(); setValue(b, 900);
    const original = network.take('a');
    const remap = (message, copy) => {
      const ids = new Map([[b.data.chartId, copy.chartId], [b.data.series[0].id, copy.series[0].id],
        [b.data.series[0].points[0].id, copy.series[0].points[0].id]]);
      return { ...message, patches: message.patches.map(patch => ({ ...patch, path: patch.path.map(key => ids.get(key) ?? key) })) };
    };
    const messages = [original[0], remap(original[1], copies[0]), remap(original[2], copies[1]), remap(original[3], copies[1])];
    messages[3].patches = messages[3].patches.map(({ value, ...patch }) => ({ ...patch, op: 'del' }));
    const latest = remap(original[4], copies[1]);
    latest.patches = latest.patches.map(({ value, ...patch }) => ({ ...patch, op: 'del' }));
    for (const scenario of ['unknown-delete', 'unknown-canonical', 'tie', 'tie-after-load', 'known-delete']) {
      const { value, ...deleted } = remap(original[0], copies[0]).patches[0];
      context.freshProcess('conflict-evidence-resume', { scenario,
        messages: scenario.startsWith('tie') ? [{ ...original[0], patches: [original[0].patches[0], { ...deleted, op: 'del' }] }] : messages,
        chartId: a.data.chartId, part: a.data.binding.chartPart, idPrefix: a.editor.doc.identity.prefix,
        baseline: a.data.series[0].points[0].value, latest });
    }
  } finally { network.result.forEach(release); }
}

export async function resumeConflictEvidence({ assert, core, edit, migration, loadShared, input }, payload) {
  const options = { edit: true, keepPackage: true, lazy: false }, documents = [], editors = [], bindings = [];
  const frames = [], errors = [];
  const open = async recoveryFrames => {
    const source = await core.parse(input, options); documents.push(source);
    const editor = new edit.Editor(edit.createDoc(source, { idPrefix: payload.idPrefix }), { recoveryFrames });
    editors.push(editor); return editor;
  };
  const bind = (editor, checkpoint, replicaId = 'a', replicaSlot = 0) => {
    let receive; const sent = [];
    const binding = migration.bindCollaboration(editor, { documentId: 'conflict-evidence', replicaId, replicaSlot,
      checkpoint, provider: { send(message) { sent.push(structuredClone(message)); }, subscribe(listener) { receive = listener; return () => {}; } },
      onError: error => errors.push(error) });
    bindings.push(binding); return { binding, receive, sent };
  };
  try {
    const editor = await open(), { binding, receive, sent } = bind(editor);
    editor.subscribeRecovery(frame => frames.push(frame));
    editor.exec({ type: 'DuplicateSlide', id: editor.doc.elements[payload.chartId].parent });
    editor.exec({ type: 'DuplicateSlide', id: editor.doc.elements[payload.chartId].parent });
    if (payload.scenario === 'tie-after-load') {
      const shared = await loadShared(); shared.registerSharedChartEditing();
      const snapshot = () => JSON.stringify({ elements: editor.doc.elements, extensions: editor.doc.extensions,
        identity: editor.doc.identity, checkpoint: binding.checkpoint(), frames });
      const before = snapshot(); payload.messages.forEach(receive);
      assert.equal(errors.length, 1, '加载后首次到达的同版本矛盾不能被基础等值回退重新接纳');
      assert.equal(snapshot(), before, '首次矛盾消息失败不安装地址或消费序号');
      const addressed = structuredClone(payload.messages[0]);
      addressed.patches.unshift({ op: 'set', origin: 'migration',
        path: ['document', 'extensions', 'edit-addresses', payload.chartId, 'other-source'],
        value: JSON.stringify({ target: ['document', 'extensions', 'other-target', 'data'], identities: {}, merge: 'equal' }) });
      receive(addressed);
      assert.equal(errors.length, 2, '无关地址前缀的内部暂存不能重新启用已否决的迁移');
      assert.equal(snapshot(), before);
      return;
    }
    payload.messages.forEach(receive); assert.deepEqual(errors, []);
    const checkpoint = binding.checkpoint();
    if (payload.scenario.startsWith('unknown-')) {
      const key = JSON.stringify(payload.messages[3].patches[0].path);
      checkpoint.extensionOperations = checkpoint.extensionOperations.filter(([candidate]) => candidate !== key);
    }
    const cold = await open(frames), restoredPeer = bind(cold, checkpoint), restored = restoredPeer.binding;
    const donor = payload.scenario === 'unknown-canonical' ? await open() : undefined;
    const donorPeer = donor && bind(donor, undefined, 'c', 2);
    if (donorPeer) { sent.forEach(donorPeer.receive); payload.messages.forEach(donorPeer.receive); }
    binding.dispose(); editor.dispose();
    const before = structuredClone({ elements: cold.doc.elements, extensions: cold.doc.extensions,
      identity: cold.doc.identity, checkpoint: restored.checkpoint() });
    const shared = await loadShared(); shared.registerSharedChartEditing();
    const states = shared.listEditableCharts(cold.doc).filter(chart => chart.binding.chartPart === payload.part)
      .map(chart => shared.queryChartData(cold.doc, chart.id));
    if (payload.scenario === 'known-delete') {
      assert.deepEqual(states.map(state => state.series[0].points[0].value), Array(3).fill(payload.baseline), '最新原删除胜出，不能复活旧数值');
      assert.ok(states.every(state => state.binding.mode !== 'readonly'));
      assert.ok(cold.doc.extensions?.['edit-migrations']);
      const after = restored.checkpoint(), tombstone = after.extensionOperations.find(([, operation]) => operation.op === 'del');
      assert.ok(tombstone);
      assert.deepEqual(after.registers.find(([key]) => key === tombstone[0])[1].stamp, payload.messages[3].stamp);
    } else {
      assert.equal(cold.doc.extensions?.['edit-migrations'], undefined);
      assert.equal(cold.doc.extensions?.['edit-addresses'], undefined, '未知或同版本冲突不能回退为等值地址迁移');
      assert.ok(states.every(state => state.binding.mode === 'readonly'));
      assert.deepEqual(structuredClone({ elements: cold.doc.elements, extensions: cold.doc.extensions,
        identity: cold.doc.identity, checkpoint: restored.checkpoint() }), before, '拒绝迁移保留原树、身份和精确版本');
      if (payload.scenario.startsWith('unknown-')) {
        let latest = payload.latest;
        if (donorPeer) {
          const state = shared.queryChartData(donor.doc, payload.chartId);
          shared.createChartDataEditor(donor).setValue(state.chartId, state.series[0].id, state.series[0].points[0].id, 999);
          latest = donorPeer.sent[donorPeer.sent.length - 1];
        }
        cold.markSaved();
        restoredPeer.receive(latest);
        const after = shared.listEditableCharts(cold.doc).filter(chart => chart.binding.chartPart === payload.part)
          .map(chart => shared.queryChartData(cold.doc, chart.id));
        assert.deepEqual(errors, [], '晚到的新原删除必须与迁移一起裁决');
        assert.deepEqual(after.map(state => state.series[0].points[0].value), Array(3).fill(donorPeer ? 999 : payload.baseline));
        assert.ok(after.every(state => state.binding.mode !== 'readonly'));
        assert.equal(cold.isDirty(), true, '迁移不能吞掉更晚普通字段操作的未保存状态');
        assert.equal(restored.checkpoint().seen.find(item => item.replicaId === latest.replicaId).contiguous, latest.sequence);
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    bindings.forEach(binding => binding.dispose());
    editors.forEach(editor => { editor.dispose(); edit.disposeDoc(editor.doc); });
    documents.forEach(source => source.dispose());
  }
}
