import { openLegacy, peers, release, setValue, values, views } from './chart-shared-legacy-migration-contract.mjs';
import { assertUnresolvedChart } from './chart-shared-unresolved-contract.mjs';

export async function runLegacyMigrationPrecopied(context) {
  const { core, edit, basic, shared, assert, input } = context, peer = await openLegacy(context), frames = [];
  peer.editor.subscribeRecovery(frame => frames.push(frame));
  try {
    const baseline = values(basic, peer)[0];
    setValue(peer, 919);
    peer.editor.exec({ type: 'DuplicateSlide', id: peer.editor.doc.elements[peer.data.chartId].parent });
    const history = peer.editor.history.undoCount;
    shared.registerSharedChartEditing();
    assert.equal(peer.editor.history.undoCount, history);
    assert.deepEqual(values(basic, peer), [919, 919], '先局部编辑再复制、最后加载共享入口，也必须读取同一旧值');
    const copy = views(basic, peer)[1];
    assert.notEqual(copy.binding.mode, 'readonly');
    shared.createChartDataEditor(peer.editor).setValue(copy.chartId, copy.series[0].id, copy.series[0].points[0].id, 778);
    assert.deepEqual(values(basic, peer), [778, 778]);
    peer.editor.undo(); peer.editor.undo(); peer.editor.undo();
    assert.deepEqual(values(basic, peer), [baseline], '复制前的旧历史也能全部撤销');
    peer.editor.redo(); peer.editor.redo(); peer.editor.redo();
    assert.deepEqual(values(basic, peer), [778, 778]);
    peer.editor.exec({ type: 'RemoveElement', id: peer.data.chartId });
    const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const cold = new edit.Editor(edit.createDoc(presentation, { idPrefix: peer.editor.doc.identity.prefix }), { recoveryFrames: frames });
    try {
      assert.deepEqual(values(basic, { ...peer, editor: cold }), [778]);
      await cold.save();
    } finally { cold.dispose(); edit.disposeDoc(cold.doc); presentation.dispose(); }
    await peer.editor.save();
  } finally { release(peer); }
}

export async function runLegacyMigrationDisjoint(context) {
  const { basic, shared, assert } = context, peer = await openLegacy(context);
  try {
    setValue(peer, 919);
    peer.api.setSeriesName(peer.data.chartId, peer.data.series[0].id, peer.data.series[0].id);
    peer.editor.exec({ type: 'DuplicateSlide', id: peer.editor.doc.elements[peer.data.chartId].parent });
    const copy = views(basic, peer)[1];
    // 构造旧版本已持久化的多所有者稀疏记录；当前基础入口已禁止继续制造这种状态。
    const legacy = peer.editor.doc.elements[copy.chartId].ovr.extensions['chart-data'];
    legacy.series[copy.series[0].id] = { points: { [copy.series[0].points[1].id]: { value: 778 } } };
    shared.registerSharedChartEditing();
    const expected = views(basic, peer).map(data => data.series[0].points.slice(0, 2).map(point => point.value));
    assert.deepEqual(expected, [[919, 778], [919, 778]], '不同旧所有者的互不冲突字段按原生记录合并');
    assert.ok(views(basic, peer).every(data => data.binding.mode !== 'readonly'));
    assert.ok(views(basic, peer).every(data => data.series[0].name === peer.data.series[0].id),
      '恰好等于来源 ID 的普通文本不能被改写');
    await peer.editor.save();
  } finally { release(peer); }
}

export async function runLegacyMigrationExisting(context) {
  const { basic, shared, assert } = context, peer = await openLegacy(context);
  try {
    setValue(peer, 919);
    peer.editor.exec({ type: 'DuplicateSlide', id: peer.editor.doc.elements[peer.data.chartId].parent });
    peer.editor.applyExternalPatches([{ op: 'set', origin: 'new-peer',
      path: ['document', 'extensions', 'chart-shared', peer.data.binding.chartPart, 'dataset',
        'series', 's0', 'points', 'c1', 'value'], value: 778 }]);
    shared.registerSharedChartEditing();
    assert.deepEqual(views(basic, peer).map(data => data.series[0].points.slice(0, 2).map(point => point.value)),
      [[919, 778], [919, 778]], '已存在的新共享字段与旧覆盖同时保留');
    await peer.editor.save();
  } finally { release(peer); }
}

export async function runLegacyMigrationConflicting(context) {
  const { basic, shared, assert } = context, peer = await openLegacy(context);
  try {
    setValue(peer, 919);
    peer.editor.exec({ type: 'DuplicateSlide', id: peer.editor.doc.elements[peer.data.chartId].parent });
    const copy = views(basic, peer)[1];
    const legacy = peer.editor.doc.elements[copy.chartId].ovr.extensions['chart-data'];
    legacy.series[copy.series[0].id] = { points: { [copy.series[0].points[0].id]: { value: 778 } } };
    const before = JSON.stringify({ elements: peer.editor.doc.elements, extensions: peer.editor.doc.extensions });
    shared.registerSharedChartEditing();
    assert.equal(JSON.stringify({ elements: peer.editor.doc.elements, extensions: peer.editor.doc.extensions }), before,
      '矛盾字段没有时钟依据时，整组保持原样，不能迁移一半');
    assert.ok(views(basic, peer).every(data => data.binding.mode === 'readonly'));
    await assertUnresolvedChart(context, peer, /字段冲突/);
  } finally { release(peer); }
}

export async function runLegacyMigrationConcurrentCopy(context) {
  const { basic, shared, assert } = context, network = await peers(context, 'legacy-concurrent-copy');
  const [a, b] = network.result;
  try {
    setValue(a, 919); network.take('b').forEach(message => network.deliver('b', message));
    a.editor.exec({ type: 'DuplicateSlide', id: a.editor.doc.elements[a.data.chartId].parent });
    const [copy] = network.take('b');
    shared.registerSharedChartEditing();
    network.deliver('b', copy);
    const set = (peer, value) => {
      const data = views(basic, peer)[1];
      shared.createChartDataEditor(peer.editor).setValue(data.chartId, data.series[0].id, data.series[0].points[0].id, value);
    };
    set(a, 778); network.take('b').forEach(message => network.deliver('b', message));
    assert.deepEqual(values(basic, b), [778, 778]);
    set(b, 889); network.take('a').forEach(message => network.deliver('a', message));
    for (const peer of [a, b]) {
      assert.deepEqual(values(basic, peer), [889, 889], '迁移时看到的框架集合不同，后续双向编辑仍收敛');
      assert.ok(views(basic, peer).every(data => data.binding.mode !== 'readonly'));
      await peer.editor.save();
    }
    assert.deepEqual(network.errors, []);
  } finally { network.result.forEach(release); }
}

export async function runLegacyMigrationRemovedOriginal(context) {
  const { basic, shared, assert } = context, peer = await openLegacy(context);
  try {
    setValue(peer, 919);
    peer.editor.exec({ type: 'DuplicateSlide', id: peer.editor.doc.elements[peer.data.chartId].parent });
    peer.editor.exec({ type: 'RemoveElement', id: peer.data.chartId });
    shared.registerSharedChartEditing();
    assert.deepEqual(values(basic, peer), [919], '原件在加载前已删除，副本里的原作用域 ID 仍指向来源记录');
    await peer.editor.save();
  } finally { release(peer); }
}

export async function runLegacyMigrationCustomIdentity(context) {
  const { edit, basic, shared, assert } = context, peer = await openLegacy(context);
  try {
    const id = 'custom:p0', order = edit.fractionalIndexBetween(peer.data.categories.at(-1).order, null);
    peer.editor.exec({ type: 'Extension', namespace: 'chart-data', id: peer.data.chartId,
      payload: { op: 'add-category', category: { id, order, label: '新增' },
        points: Object.fromEntries(peer.data.series.map(series => [series.id, { id, order, value: 777 }])) } });
    peer.editor.exec({ type: 'DuplicateSlide', id: peer.editor.doc.elements[peer.data.chartId].parent });
    shared.registerSharedChartEditing();
    for (const data of views(basic, peer)) {
      assert.equal(data.categories.length, peer.data.categories.length + 1);
      assert.equal(data.categories[0].label, peer.data.categories[0].label);
      assert.equal(data.categories.at(-1).id, id, '自定义新增 ID 与原生记录同尾缀，也必须原样保留');
      assert.equal(data.series[0].points.at(-1).value, 777);
    }
    await peer.editor.save();
  } finally { release(peer); }
}

export async function runLegacyMigrationRemovedSourceSlide(context) {
  const { basic, shared, assert } = context, peer = await openLegacy(context), frames = [];
  peer.editor.subscribeRecovery(frame => frames.push(frame));
  try {
    setValue(peer, 919);
    const source = peer.editor.doc.elements[peer.data.chartId].parent;
    peer.editor.exec({ type: 'DuplicateSlide', id: source });
    const beforeFailure = peer.editor.doc.retainedElementOrigins;
    const survivor = views(basic, peer)[1].chartId;
    assert.throws(() => peer.editor.transaction(tx => {
      tx.exec({ type: 'RemoveSlide', id: source });
      tx.exec({ type: 'SetName', id: survivor, name: 123 });
    }));
    assert.equal(peer.editor.doc.retainedElementOrigins, beforeFailure, '失败事务不能残留来源身份');
    peer.editor.exec({ type: 'RemoveSlide', id: source });
    await context.freshProcess('removed-source-slide-resume', { frames, chartPart: peer.data.binding.chartPart });
    const undoCount = peer.editor.history.undoCount;
    shared.registerSharedChartEditing();
    assert.equal(peer.editor.history.undoCount, undoCount);
    assert.deepEqual(values(basic, peer), [919], '删除整个原页仍保留幸存副本中的旧值');
    const copy = views(basic, peer)[0];
    shared.createChartDataEditor(peer.editor).setValue(copy.chartId, copy.series[0].id, copy.series[0].points[0].id, 778);
    assert.deepEqual(values(basic, peer), [778]);
    peer.editor.undo(); peer.editor.undo();
    assert.deepEqual(values(basic, peer), [919, 919], '撤销删除源页后两框架仍引用相同数据');
    peer.editor.redo(); peer.editor.redo();
    assert.deepEqual(values(basic, peer), [778]);
    await assertRemovedSlideSaved(context, peer, 778);
    await context.freshProcess('removed-source-slide-resume', { frames, chartPart: peer.data.binding.chartPart, value: 778 });
  } finally { release(peer); }
}

export async function runLegacyMigrationRemovedCopyChain(context) {
  const { basic, shared, assert } = context, peer = await openLegacy(context), frames = [];
  peer.editor.subscribeRecovery(frame => frames.push(frame));
  try {
    setValue(peer, 919);
    const source = peer.editor.doc.elements[peer.data.chartId].parent;
    peer.editor.exec({ type: 'DuplicateSlide', id: source });
    const middle = peer.editor.doc.elements[views(basic, peer)[1].chartId].parent;
    peer.editor.exec({ type: 'DuplicateSlide', id: middle });
    peer.editor.exec({ type: 'RemoveSlide', id: middle });
    peer.editor.exec({ type: 'RemoveSlide', id: source });
    await context.freshProcess('removed-source-slide-resume', { frames, chartPart: peer.data.binding.chartPart });
    shared.registerSharedChartEditing();
    assert.deepEqual(values(basic, peer), [919], '最初来源与中间副本全部删除，末端副本仍保留旧值');
    peer.editor.undo(); peer.editor.undo();
    assert.deepEqual(values(basic, peer), [919, 919, 919], '复活中间副本的快照也须清除已迁移的旧覆盖');
    assert.ok(views(basic, peer).every(data => data.binding.mode !== 'readonly'));
    await peer.editor.save();
    peer.editor.redo(); peer.editor.redo();
    await assertRemovedSlideSaved(context, peer, 919);
  } finally { release(peer); }
}

export async function runLegacyMigrationRemovedSlideMessage(context) {
  const { basic, shared, assert } = context, network = await peers(context, 'legacy-removed-slide-message');
  const [a, b] = network.result;
  try {
    setValue(a, 919); network.take('b').forEach(message => network.deliver('b', message));
    setValue(a, 778);
    const [late] = network.take('b');
    const source = b.editor.doc.elements[b.data.chartId].parent;
    b.editor.exec({ type: 'DuplicateSlide', id: source });
    b.editor.exec({ type: 'RemoveSlide', id: source });
    shared.registerSharedChartEditing();
    network.deliver('b', late); network.deliver('b', late);
    assert.deepEqual(values(basic, b), [778], '原页已删除后到达的较新旧地址字段更新幸存副本');
    assert.deepEqual(network.errors, []);
    await assertRemovedSlideSaved(context, b, 778);
  } finally { network.result.forEach(release); }
}

export async function runLegacyMigrationConcurrentRemoval(context) {
  const { basic, shared, assert } = context, network = await peers(context, 'legacy-concurrent-removal');
  const [a, b] = network.result;
  try {
    setValue(a, 919); network.take('b').forEach(message => network.deliver('b', message));
    a.editor.exec({ type: 'DuplicateSlide', id: a.editor.doc.elements[a.data.chartId].parent });
    network.take('b').forEach(message => network.deliver('b', message));
    const copy = views(basic, a)[1];
    a.editor.exec({ type: 'RemoveSlide', id: a.editor.doc.elements[copy.chartId].parent });
    const [removal] = network.take('b');
    shared.registerSharedChartEditing();
    network.deliver('b', removal);
    for (const [sender, receiver, value] of [[a, 'b', 778], [b, 'a', 889]]) {
      const data = views(basic, sender)[0];
      shared.createChartDataEditor(sender.editor).setValue(data.chartId, data.series[0].id, data.series[0].points[0].id, value);
      network.take(receiver).forEach(message => network.deliver(receiver, message));
      assert.deepEqual(values(basic, a), [value]);
      assert.deepEqual(values(basic, b), [value], '迁移时副本在一端已删除、另一端仍存活，双方地址保持一致');
    }
    assert.deepEqual(network.errors, []);
  } finally { network.result.forEach(release); }
}

async function assertRemovedSlideSaved({ core, edit, basic, assert }, peer, value) {
  const bytes = await peer.editor.save();
  const presentation = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
  const doc = edit.createDoc(presentation);
  try {
    const data = basic.listEditableCharts(doc).filter(frame => frame.binding.chartPart === peer.data.binding.chartPart);
    assert.equal(data.length, 1, '保存文件中只剩幸存框架');
    assert.equal(basic.queryChartData(doc, data[0].id).series[0].points[0].value, value);
  } finally { edit.disposeDoc(doc); presentation.dispose(); }
}

export async function resumeLegacyMigrationRemovedSourceSlide(context, { frames, chartPart, value = 919 }) {
  const { core, edit, basic, shared, assert, input } = context;
  const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(presentation, { idPrefix: 'legacy-migration-' }), { recoveryFrames: frames });
  const peer = { editor, presentation, data: { binding: { chartPart } }, disposeDoc: () => edit.disposeDoc(editor.doc) };
  try {
    shared.registerSharedChartEditing();
    assert.deepEqual(values(basic, peer), [value], '全新进程恢复旧删除补丁后再加载共享，来源身份仍可定位');
    assert.ok(views(basic, peer).every(data => data.binding.mode !== 'readonly'));
    await assertRemovedSlideSaved(context, peer, value);
  } finally { release(peer); }
}

export async function runLegacyMigrationIdentityCollision(context, copyOnly = false) {
  const { edit, basic, shared, assert } = context, probe = await openLegacy(context);
  let id;
  try {
    probe.editor.exec({ type: 'DuplicateSlide', id: probe.editor.doc.elements[probe.data.chartId].parent });
    id = `${views(basic, probe)[1].chartId}:p0`;
  } finally { release(probe); }
  const peer = await openLegacy(context);
  try {
    const order = edit.fractionalIndexBetween(peer.data.categories.at(-1).order, null);
    peer.editor.exec({ type: 'Extension', namespace: 'chart-data', id: peer.data.chartId,
      payload: { op: 'add-category', category: { id, order, label: '新增' },
        points: Object.fromEntries(peer.data.series.map(series => [series.id, { id, order, value: 777 }])) } });
    peer.editor.exec({ type: 'DuplicateSlide', id: peer.editor.doc.elements[peer.data.chartId].parent });
    if (copyOnly) {
      // 旧对端可能只留下副本的覆盖；失败提示也必须传播到没有局部字段的原框架。
      delete peer.editor.doc.elements[peer.data.chartId].ovr.extensions['chart-data'];
      peer.editor.effectiveElement(peer.data.chartId);
    }
    const before = JSON.stringify({ elements: peer.editor.doc.elements, extensions: peer.editor.doc.extensions });
    shared.registerSharedChartEditing();
    assert.equal(JSON.stringify({ elements: peer.editor.doc.elements, extensions: peer.editor.doc.extensions }), before,
      '合法自定义新增 ID 恰好撞上未来副本来源时，不覆盖原生类别');
    assert.ok(views(basic, peer).every(data => data.binding.mode === 'readonly'));
    await assert.rejects(peer.editor.save());
    await assertUnresolvedChart(context, peer, /新增记录身份与复制来源身份冲突/);
  } finally { release(peer); }
}
