const PNG_WHITE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PNG_COLOR = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XxRcbAAAAABJRU5ErkJggg==';
const bytesOf = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

const createdElement = (result) => result.forward.find((patch) =>
  patch.op === 'insert' && patch.path[0] === 'elements')?.path[1];

export async function runCollabHardeningContract({
  bindPair, check, collab, core, createPair, edit, editableShapes, load, OfflineHub,
  semanticDoc, stringDiff,
}) {
  console.log('\n\x1b[36m▸ 自物化层级 patch 与结构历史闭包\x1b[0m');
  {
    const pair = await createPair('sample-editor-align.pptx', 'collab-group-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const byParent = new Map();
    for (const record of editableShapes(pair.left)) {
      byParent.set(record.parent, [...(byParent.get(record.parent) ?? []), record]);
    }
    const candidates = [...byParent.values()].find((records) => records.length >= 2).slice(0, 2);
    const result = pair.leftEditor.exec({ type: 'Group', ids: candidates.map((record) => record.id) });
    const groupId = result.forward.find((patch) => patch.path[2] === 'hierarchy')?.path[1];
    hub.flush();
    check('Group 的自包含 ElementHierarchyPatch 不依赖预先存在的目标',
      pair.left.elements[groupId]?.src.kind === 'group'
      && pair.right.elements[groupId]?.src.kind === 'group');
    check('Group 同步后完整 EditDoc 收敛且无 deferred 错误', semanticDoc(pair.left)
      === semanticDoc(pair.right) && errors.length === 0,
    stringDiff(semanticDoc(pair.left), semanticDoc(pair.right)));
    pair.rightEditor.exec({ type: 'Ungroup', id: groupId });
    hub.flush();
    check('Ungroup 层级原子补丁同样收敛', semanticDoc(pair.left) === semanticDoc(pair.right));
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('sample-editor-align.pptx', 'collab-group-remove-wins-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const byParent = new Map();
    for (const record of editableShapes(pair.left)) {
      byParent.set(record.parent, [...(byParent.get(record.parent) ?? []), record]);
    }
    const candidates = [...byParent.values()].find((records) => records.length >= 2).slice(0, 2);
    pair.leftEditor.exec({ type: 'RemoveElement', id: candidates[0].id });
    pair.rightEditor.exec({ type: 'Group', ids: candidates.map((record) => record.id) });
    hub.flush((items) => items.reverse());
    const groups = (doc) => Object.values(doc.elements).filter((record) =>
      record.src.kind === 'group' && record.meta.created);
    check('并发删除与组合按成员 remove-wins 收敛且不留下孤儿父链',
      !pair.left.elements[candidates[0].id] && !pair.right.elements[candidates[0].id]
      && groups(pair.left).length === 1 && groups(pair.left)[0].children.length === 1
      && semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0,
    `${stringDiff(semanticDoc(pair.left), semanticDoc(pair.right))} / ${errors.map(String).join(' / ')}`);
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('sample-editor-align.pptx', 'collab-group-overlap-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const byParent = new Map();
    for (const record of editableShapes(pair.left)) {
      byParent.set(record.parent, [...(byParent.get(record.parent) ?? []), record]);
    }
    const candidates = [...byParent.values()].find((records) => records.length >= 2).slice(0, 2);
    pair.leftEditor.exec({ type: 'Group', ids: candidates.map((record) => record.id) });
    pair.rightEditor.exec({ type: 'Group', ids: candidates.map((record) => record.id) });
    hub.flush((items) => items.reverse());
    const createdGroups = (doc) => Object.values(doc.elements).filter((record) =>
      record.src.kind === 'group' && record.meta.created);
    check('重叠 Group 按成员冲突域 LWW，落败空组被原子清理',
      createdGroups(pair.left).length === 1 && semanticDoc(pair.left) === semanticDoc(pair.right)
      && errors.length === 0,
    `${stringDiff(semanticDoc(pair.left), semanticDoc(pair.right))} / ${errors.map(String).join(' / ')}`);
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('showcase.pptx', 'collab-group-disjoint-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const byParent = new Map();
    for (const record of editableShapes(pair.left)) {
      byParent.set(record.parent, [...(byParent.get(record.parent) ?? []), record]);
    }
    const candidates = [...byParent.values()].find((records) => records.length >= 4).slice(0, 4);
    pair.leftEditor.exec({ type: 'Group', ids: candidates.slice(0, 2).map((record) => record.id) });
    pair.rightEditor.exec({ type: 'Group', ids: candidates.slice(2).map((record) => record.id) });
    hub.flush((items) => items.reverse());
    const groups = Object.values(pair.left.elements).filter((record) =>
      record.src.kind === 'group' && record.meta.created);
    check('同父级不相交 Group 可交换合并 parent children', groups.length === 2
      && semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0,
    `${stringDiff(semanticDoc(pair.left), semanticDoc(pair.right))} / ${errors.map(String).join(' / ')}`);
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('showcase.pptx', 'collab-group-partial-overlap-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const byParent = new Map();
    for (const record of editableShapes(pair.left)) {
      byParent.set(record.parent, [...(byParent.get(record.parent) ?? []), record]);
    }
    const candidates = [...byParent.values()].find((records) => records.length >= 3).slice(0, 3);
    pair.leftEditor.exec({ type: 'Group', ids: candidates.slice(0, 2).map((record) => record.id) });
    pair.rightEditor.exec({ type: 'Group', ids: candidates.slice(1).map((record) => record.id) });
    hub.flush((items) => items.reverse());
    check('部分重叠 Group 只裁掉输掉的成员冲突域并保留不相交意图',
      semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0,
    `${stringDiff(semanticDoc(pair.left), semanticDoc(pair.right))} / ${errors.map(String).join(' / ')}`);
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('showcase.pptx', 'collab-outer-ungroup-nested-group-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const byParent = new Map();
    for (const record of editableShapes(pair.left)) {
      byParent.set(record.parent, [...(byParent.get(record.parent) ?? []), record]);
    }
    const candidates = [...byParent.values()].find((records) => records.length >= 3).slice(0, 3);
    const outer = pair.leftEditor.exec({ type: 'Group', ids: candidates.map((record) => record.id) });
    const outerId = outer.forward.find((patch) => patch.path[2] === 'hierarchy')?.path[1];
    hub.flush();
    pair.leftEditor.exec({ type: 'Ungroup', id: outerId });
    pair.rightEditor.exec({ type: 'Group', ids: candidates.slice(0, 2).map((record) => record.id) });
    hub.flush((items) => items.reverse());
    check('外层 Ungroup remove-wins 于容器内部的并发嵌套 Group',
      !pair.left.elements[outerId] && !pair.right.elements[outerId]
      && semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0,
    `${stringDiff(semanticDoc(pair.left), semanticDoc(pair.right))} / ${errors.map(String).join(' / ')}`);
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('showcase.pptx', 'collab-inner-ungroup-outer-group-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const byParent = new Map();
    for (const record of editableShapes(pair.left)) {
      byParent.set(record.parent, [...(byParent.get(record.parent) ?? []), record]);
    }
    const candidates = [...byParent.values()].find((records) => records.length >= 3).slice(0, 3);
    const inner = pair.leftEditor.exec({ type: 'Group', ids: candidates.slice(0, 2).map(({ id }) => id) });
    const innerId = inner.forward.find((patch) => patch.path[2] === 'hierarchy')?.path[1];
    hub.flush();
    pair.leftEditor.exec({ type: 'Group', ids: [innerId, candidates[2].id] });
    pair.rightEditor.exec({ type: 'Ungroup', id: innerId });
    hub.flush((items) => items.reverse());
    check('内层 Ungroup 会从并发新增外组 children 移除被拆容器并保持收敛',
      !pair.left.elements[innerId] && !pair.right.elements[innerId]
      && semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0,
    `${stringDiff(semanticDoc(pair.left), semanticDoc(pair.right))} / ${errors.map(String).join(' / ')}`);
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('sample-editor-align.pptx', 'collab-ungroup-paste-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const byParent = new Map();
    for (const record of editableShapes(pair.left)) {
      byParent.set(record.parent, [...(byParent.get(record.parent) ?? []), record]);
    }
    const candidates = [...byParent.values()].find((records) => records.length >= 2).slice(0, 2);
    const payload = edit.copyElements(pair.left, [candidates[0].id]);
    const grouped = pair.leftEditor.exec({ type: 'Group', ids: candidates.map(({ id }) => id) });
    const groupId = grouped.forward.find((patch) => patch.path[2] === 'hierarchy')?.path[1];
    hub.flush();
    pair.leftEditor.exec({ type: 'Ungroup', id: groupId });
    const pasted = pair.rightEditor.exec({
      type: 'PasteElements', payload, at: { parentId: groupId, x: 100, y: 100 },
    }).forward.find((patch) => patch.op === 'insert' && patch.path[0] === 'elements').path[1];
    pair.rightEditor.exec({ type: 'SetZ', id: pasted, to: 'back' });
    hub.flush((items) => items.reverse());
    check('Ungroup remove-wins 于并发粘入组内的新子树及其中途 SetZ 且不留下孤儿',
      !pair.left.elements[groupId] && !pair.right.elements[groupId]
      && !pair.left.elements[pasted] && !pair.right.elements[pasted]
      && semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0,
    `${stringDiff(semanticDoc(pair.left), semanticDoc(pair.right))} / ${errors.map(String).join(' / ')}`);
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('sample-editor-align.pptx', 'collab-group-field-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const byParent = new Map();
    for (const record of editableShapes(pair.left)) {
      byParent.set(record.parent, [...(byParent.get(record.parent) ?? []), record]);
    }
    const candidates = [...byParent.values()].find((records) => records.length >= 2).slice(0, 2);
    const x = candidates[0].src.x + 135;
    pair.leftEditor.exec({ type: 'Group', ids: candidates.map((record) => record.id) });
    pair.rightEditor.exec({ type: 'SetXfrm', id: candidates[0].id, x });
    hub.flush((items) => items.reverse());
    check('Group 只重基父链，不覆盖并发字段级 SetXfrm',
      pair.left.elements[candidates[0].id]?.ovr.x === x
      && semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0,
    `${stringDiff(semanticDoc(pair.left), semanticDoc(pair.right))} / ${errors.map(String).join(' / ')}`);
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('sample-editor-align.pptx', 'collab-group-order-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const byParent = new Map();
    for (const record of editableShapes(pair.left)) {
      byParent.set(record.parent, [...(byParent.get(record.parent) ?? []), record]);
    }
    const candidates = [...byParent.values()].find((records) => records.length >= 2).slice(0, 2);
    pair.leftEditor.exec({ type: 'Group', ids: candidates.map((record) => record.id) });
    pair.rightEditor.exec({ type: 'SetZ', id: candidates[0].id, to: 'front' });
    hub.flush((items) => items.reverse());
    check('Group 的成员 order 与并发 SetZ 按字段 stamp 收敛',
      semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0,
    `${stringDiff(semanticDoc(pair.left), semanticDoc(pair.right))} / ${errors.map(String).join(' / ')}`);
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('sample-editor-align.pptx', 'collab-delete-ungroup-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const byParent = new Map();
    for (const record of editableShapes(pair.left)) {
      byParent.set(record.parent, [...(byParent.get(record.parent) ?? []), record]);
    }
    const candidates = [...byParent.values()].find((records) => records.length >= 2).slice(0, 2);
    const grouped = pair.leftEditor.exec({ type: 'Group', ids: candidates.map((record) => record.id) });
    const groupId = grouped.forward.find((patch) => patch.path[2] === 'hierarchy')?.path[1];
    hub.flush();
    pair.leftEditor.exec({ type: 'RemoveElement', id: groupId });
    pair.rightEditor.exec({ type: 'Ungroup', id: groupId });
    hub.flush((items) => items.reverse());
    check('删组与并发 Ungroup 按整棵删除树 remove-wins',
      !pair.left.elements[groupId] && !pair.right.elements[groupId]
      && candidates.every((record) => !pair.left.elements[record.id] && !pair.right.elements[record.id])
      && semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0,
    `${stringDiff(semanticDoc(pair.left), semanticDoc(pair.right))} / ${errors.map(String).join(' / ')}`);
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('showcase.pptx', 'collab-delete-nested-regroup-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const byParent = new Map();
    for (const record of editableShapes(pair.left)) {
      byParent.set(record.parent, [...(byParent.get(record.parent) ?? []), record]);
    }
    const candidates = [...byParent.values()].find((records) => records.length >= 2).slice(0, 2);
    const outer = pair.leftEditor.exec({ type: 'Group', ids: candidates.map((record) => record.id) });
    const outerId = outer.forward.find((patch) => patch.path[2] === 'hierarchy')?.path[1];
    hub.flush();
    pair.leftEditor.exec({ type: 'RemoveElement', id: outerId });
    const nested = pair.rightEditor.exec({ type: 'Group', ids: candidates.map((record) => record.id) });
    const nestedId = nested.forward.find((patch) => patch.path[2] === 'hierarchy')?.path[1];
    hub.flush((items) => items.reverse());
    check('删组 remove-wins 会把并发新增的当前后代纳入删除闭包',
      [outerId, nestedId, ...candidates.map((record) => record.id)].every((id) =>
        !pair.left.elements[id] && !pair.right.elements[id])
      && semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0,
    `${stringDiff(semanticDoc(pair.left), semanticDoc(pair.right))} / ${errors.map(String).join(' / ')}`);
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('sample-editor-remove-slide.pptx', 'collab-remove-slide-history-');
    const hub = new OfflineHub();
    const bindings = bindPair(pair, hub);
    const slideId = pair.left.slideOrder.find((id) => pair.left.slides[id].children.some((child) =>
      pair.left.elements[child]?.src.kind === 'shape' && pair.left.elements[child].meta.editable === 'full'));
    const target = pair.left.slides[slideId].children.map((id) => pair.left.elements[id])
      .find((record) => record?.src.kind === 'shape' && record.meta.editable === 'full');
    pair.leftEditor.exec({ type: 'SetXfrm', id: target.id, x: target.src.x + 20 });
    hub.flush();
    pair.rightEditor.exec({ type: 'RemoveSlide', id: slideId });
    hub.flush();
    let undo = 'threw';
    try { undo = pair.leftEditor.undo(); } catch { /* 失败值保留给断言。 */ }
    check('远端删页会裁掉 snapshot.records 内所有元素历史', pair.leftEditor.history.undoCount === 0
      && undo === null);
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('sample-editor-remove-slide.pptx', 'collab-remove-slide-field-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const slideId = pair.left.slideOrder.find((id) => pair.left.slides[id].children.some((child) =>
      pair.left.elements[child]?.meta.editable === 'full'));
    const target = pair.left.slides[slideId].children.map((id) => pair.left.elements[id])
      .find((record) => record?.meta.editable === 'full');
    pair.leftEditor.exec({ type: 'RemoveSlide', id: slideId });
    pair.rightEditor.exec({ type: 'SetXfrm', id: target.id, x: 777 });
    hub.flush((items) => items.reverse());
    pair.leftEditor.undo();
    hub.flush();
    check('删页对子元素建立 remove-wins，随后同副本 undo 恢复仍确定性收敛',
      pair.left.elements[target.id]?.ovr.x !== 777
      && semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0,
    `${stringDiff(semanticDoc(pair.left), semanticDoc(pair.right))} / ${errors.map(String).join(' / ')}`);
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('sample-editor-remove-slide.pptx', 'collab-remove-slide-insert-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const slideId = pair.left.slideOrder.find((id) => pair.left.slides[id].children.some((child) =>
      pair.left.elements[child]?.meta.editable === 'full'));
    pair.leftEditor.exec({ type: 'RemoveSlide', id: slideId });
    const inserted = pair.rightEditor.exec({
      type: 'AddShape', slideId, preset: 'rect', rect: { x: 10, y: 10, w: 80, h: 60 },
    }).forward.find((patch) => patch.op === 'insert' && patch.path[0] === 'elements').path[1];
    hub.flush((items) => items.reverse());
    check('删页按接收端当前整页闭包重基，并发 AddShape 不会留下孤儿或永久 deferred',
      !pair.left.slides[slideId] && !pair.right.slides[slideId]
      && !pair.left.elements[inserted] && !pair.right.elements[inserted]
      && semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0,
    `${stringDiff(semanticDoc(pair.left), semanticDoc(pair.right))} / ${errors.map(String).join(' / ')}`);
    bindings.forEach((binding) => binding.dispose());
  }

  console.log('\n\x1b[36m▸ 恢复 checkpoint 的旧消息幂等\x1b[0m');
  {
    const pair = await createPair('showcase.pptx', 'collab-remove-undo-reorder-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const target = editableShapes(pair.right)[0];
    pair.rightEditor.exec({ type: 'RemoveElement', id: target.id });
    pair.rightEditor.undo();
    hub.flush((items) => items.reverse());
    check('同副本 RemoveElement→undo 逆序投递不让旧删除压过新恢复',
      !!pair.left.elements[target.id] && !!pair.right.elements[target.id]
      && semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0,
    `${stringDiff(semanticDoc(pair.left), semanticDoc(pair.right))} / ${errors.map(String).join(' / ')}`);
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const input = load('showcase.pptx');
    const pair = await createPair('showcase.pptx', 'collab-checkpoint-');
    const hub = new OfflineHub();
    const frames = [];
    const stopRecovery = pair.leftEditor.subscribeRecovery((frame) => frames.push(frame));
    const bindings = bindPair(pair, hub);
    const target = editableShapes(pair.left)[0];
    pair.rightEditor.exec({ type: 'SetXfrm', id: target.id, x: 111 });
    const oldMessages = structuredClone(hub.queue);
    hub.flush();
    pair.rightEditor.exec({ type: 'SetXfrm', id: target.id, x: 222 });
    hub.flush();
    const checkpoint = bindings[0].checkpoint();
    stopRecovery();
    bindings.forEach((binding) => binding.dispose());

    const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const restoredDoc = edit.createDoc(presentation, { idPrefix: 'collab-checkpoint-' });
    const restoredEditor = new edit.Editor(restoredDoc, { recoveryFrames: frames });
    const restoredHub = new OfflineHub();
    let rejectedWithoutCheckpoint = false;
    try {
      collab.bindCollaboration(restoredEditor, {
        documentId: 'deck', replicaId: 'a', replicaSlot: 1, provider: restoredHub.endpoint('a'),
      });
    } catch { rejectedWithoutCheckpoint = true; }
    const restoredBinding = collab.bindCollaboration(restoredEditor, {
      documentId: 'deck', replicaId: 'a', replicaSlot: 1,
      provider: restoredHub.endpoint('a'), checkpoint,
    });
    restoredHub.replay(oldMessages);
    check('恢复文档缺 checkpoint 会 fail-fast 而不是猜测 LWW 状态', rejectedWithoutCheckpoint);
    check('恢复 checkpoint 后重放旧远端消息不会把 222 回滚成 111',
      restoredDoc.elements[target.id].ovr.x === 222);
    restoredBinding.dispose();
  }

  console.log('\n\x1b[36m▸ 新 part SPID 与资源 rId 固定槽分配\x1b[0m');
  {
    const pair = await createPair('sample-editor-add-slide.pptx', 'collab-new-part-');
    const hub = new OfflineHub();
    const errors = [];
    const left = collab.bindCollaboration(pair.leftEditor, {
      documentId: 'new-part', replicaId: 'a', replicaSlot: 1, provider: hub.endpoint('a'),
      onError: (error) => errors.push(error),
    });
    const right = collab.bindCollaboration(pair.rightEditor, {
      documentId: 'new-part', replicaId: 'b', replicaSlot: 0, provider: hub.endpoint('b'),
      onError: (error) => errors.push(error),
    });
    const added = [...pair.leftEditor.exec({
      type: 'AddSlide', layoutId: pair.left.layoutOrder[0], at: { after: pair.left.slideOrder[0] },
    }).createdSlides][0];
    hub.flush();
    const rightAdded = [...pair.rightEditor.exec({
      type: 'AddSlide', layoutId: pair.right.layoutOrder[0], at: { after: pair.right.slideOrder[0] },
    }).createdSlides][0];
    hub.flush();
    check('接收远端 AddSlide 水位后本副本仍沿已固化 slot 分区新增页',
      !!pair.left.slides[rightAdded] && !!pair.right.slides[rightAdded]
      && semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0,
    `${stringDiff(semanticDoc(pair.left), semanticDoc(pair.right))} / ${errors.map(String).join(' / ')}`);
    pair.leftEditor.exec({
      type: 'AddShape', slideId: added, preset: 'rect', rect: { x: 10, y: 10, w: 40, h: 30 },
    });
    hub.flush();
    const leftShape = createdElement(pair.leftEditor.exec({
      type: 'AddShape', slideId: added, preset: 'rect', rect: { x: 60, y: 10, w: 40, h: 30 },
    }));
    const rightShape = createdElement(pair.rightEditor.exec({
      type: 'AddShape', slideId: added, preset: 'ellipse', rect: { x: 110, y: 10, w: 40, h: 30 },
    }));
    const allocated = [pair.left.elements[leftShape].meta.origin.spid,
      pair.right.elements[rightShape].meta.origin.spid];
    hub.flush((items) => items.reverse());
    check('新 part 首次触碰时不同 slot 的 SPID 同余槽不碰撞', new Set(allocated).size === 2);
    check('高 slot 先写、低 slot 后触碰再并发仍收敛', semanticDoc(pair.left)
      === semanticDoc(pair.right) && errors.length === 0,
    stringDiff(semanticDoc(pair.left), semanticDoc(pair.right)));
    left.dispose();
    right.dispose();
  }

  {
    const pair = await createPair('sample-editor-add-slide.pptx', 'collab-spid-restore-slot-');
    const binding = collab.bindCollaboration(pair.leftEditor, {
      documentId: 'spid-restore-slot', replicaId: 'slot-owner', replicaSlot: 17,
      provider: { send() {}, subscribe() { return () => {}; } },
    });
    const allocation = structuredClone(pair.left.identity.allocation);
    const key = Object.keys(allocation.ranges).find((candidate) => candidate.startsWith('spid:'));
    allocation.ranges[key].next++;
    let rejected = false;
    try { edit.assertIdentityAllocation(allocation, '测试身份分区', pair.left.identity.prefix); }
    catch { rejected = true; }
    check('恢复身份拒绝偏离 replica slot 同余分区的 SPID 游标', rejected);
    const blockAllocation = structuredClone(pair.left.identity.allocation);
    blockAllocation.ranges.slidePart.end++;
    let blockRejected = false;
    try { edit.assertIdentityAllocation(blockAllocation, '测试连续身份区间', pair.left.identity.prefix); }
    catch { blockRejected = true; }
    check('恢复身份拒绝篡改全局连续 ID 区间边界', blockRejected);
    binding.dispose();
  }

  {
    const pair = await createPair('sample-editor-add-slide.pptx', 'collab-media-rid-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const slideId = pair.left.slideOrder[0];
    const leftImage = createdElement(pair.leftEditor.exec({
      type: 'AddImage', slideId, bytes: bytesOf(PNG_WHITE), mime: 'image/png',
      rect: { x: 10, y: 10, w: 20, h: 20 },
    }));
    const rightImage = createdElement(pair.rightEditor.exec({
      type: 'AddImage', slideId, bytes: bytesOf(PNG_COLOR), mime: 'image/png',
      rect: { x: 40, y: 10, w: 20, h: 20 },
    }));
    const relationshipIds = [pair.left.elements[leftImage], pair.right.elements[rightImage]]
      .map((record) => record.meta.insertion.relationships[0].targetId);
    hub.flush((items) => items.reverse());
    check('同页并发媒体关系 rId 使用不同固定槽', new Set(relationshipIds).size === 2);
    check('并发 AddImage 资源闭包收敛且无重复 rId 错误', semanticDoc(pair.left)
      === semanticDoc(pair.right) && errors.length === 0,
    `${stringDiff(semanticDoc(pair.left), semanticDoc(pair.right))} / ${errors.map(String).join(' / ')}`);
    bindings.forEach((binding) => binding.dispose());
  }

}
