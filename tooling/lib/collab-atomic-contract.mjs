export async function runCollabAtomicContract({
  bindPair, check, collab, core, createPair, edit, editableShapes, load, OfflineHub, semanticDoc,
}) {
  console.log('\n\x1b[36m▸ 协同消息单帧恢复与文档身份边界\x1b[0m');
  {
    const pair = await createPair('showcase.pptx', 'collab-prefix-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const target = editableShapes(pair.left)[0];
    pair.leftEditor.exec({ type: 'SetXfrm', id: target.id, x: target.src.x + 41 });
    const original = structuredClone(hub.queue[0]);
    const poisoned = structuredClone(original);
    const suffix = poisoned.message.identity.allocation.prefix
      .slice(poisoned.message.identity.prefix.length);
    poisoned.message.identity.prefix = 'foreign-document-';
    poisoned.message.identity.allocation.prefix = `foreign-document-${suffix}`;
    hub.queue.length = 0;
    hub.replay([poisoned]);
    const unchanged = pair.right.elements[target.id].ovr.x !== target.src.x + 41;
    hub.replay([original]);
    check('错误文档 prefix fail-fast 且不消费 seen，修正后可重放', unchanged
      && pair.right.elements[target.id].ovr.x === target.src.x + 41 && errors.length === 1,
    errors.map(String).join(' / '));
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('showcase.pptx', 'collab-structure-deferred-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const slideId = pair.left.slideOrder[0];
    const dependency = pair.leftEditor.exec({
      type: 'AddShape', slideId, preset: 'rect', rect: { x: 10, y: 10, w: 80, h: 60 },
    }).forward.find((patch) => patch.op === 'insert' && patch.path[0] === 'elements').path[1];
    const transaction = pair.leftEditor.exec(
      { type: 'AddShape', slideId, preset: 'ellipse', rect: { x: 100, y: 10, w: 80, h: 60 } },
      { type: 'SetXfrm', id: dependency, x: 321 },
    );
    const inserted = transaction.forward.find((patch) =>
      patch.op === 'insert' && patch.path[0] === 'elements').path[1];
    const messages = structuredClone(hub.queue);
    hub.queue.length = 0;
    const frames = [];
    const stopRecovery = pair.rightEditor.subscribeRecovery((frame) => frames.push(frame));
    hub.replay([messages[1]]);
    const wholeMessageWaited = !pair.right.elements[inserted] && !pair.right.elements[dependency]
      && frames.length === 1 && frames[0].patches.length === 0;
    hub.replay([messages[0]]);
    stopRecovery();
    check('结构 patch 与缺依赖字段同消息时整批等待，依赖到达后一帧共同落模',
      wholeMessageWaited && pair.right.elements[inserted]
      && pair.right.elements[dependency]?.ovr.x === 321 && frames.length === 2
      && errors.length === 0,
    errors.map(String).join(' / '));
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('sample-editor-add-slide.pptx', 'collab-slide-fields-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const added = [...pair.leftEditor.exec({
      type: 'AddSlide', layoutId: pair.left.layoutOrder[0], at: { after: pair.left.slideOrder[0] },
    }).createdSlides][0];
    const placeholder = pair.left.slides[added].children.map((id) => pair.left.elements[id])
      .find((record) => record?.meta.editable === 'full');
    pair.leftEditor.exec(
      { type: 'SetHidden', id: added, v: true },
      { type: 'SetXfrm', id: placeholder.id, x: 123 },
    );
    const messages = structuredClone(hub.queue);
    const combined = structuredClone(messages[0]);
    combined.message.patches = messages.flatMap((item) => item.message.patches);
    hub.queue.length = 0;
    const frames = [];
    const stopRecovery = pair.rightEditor.subscribeRecovery((frame) => frames.push(frame));
    hub.replay([combined]);
    stopRecovery();
    check('AddSlide 与新页/新占位符字段在接收端只产生一帧 recovery',
      pair.right.slides[added]?.ovr.hidden === true
      && pair.right.elements[placeholder.id]?.ovr.x === 123
      && frames.length === 1 && errors.length === 0,
    errors.map(String).join(' / '));
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('sample-editor-add-slide.pptx', 'collab-slide-child-chain-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const added = [...pair.leftEditor.exec({
      type: 'AddSlide', layoutId: pair.left.layoutOrder[0], at: { after: pair.left.slideOrder[0] },
    }).createdSlides][0];
    const inserted = pair.leftEditor.exec({
      type: 'AddShape', slideId: added, preset: 'rect', rect: { x: 10, y: 10, w: 80, h: 60 },
    }).forward.find((patch) => patch.op === 'insert' && patch.path[0] === 'elements').path[1];
    const messages = structuredClone(hub.queue);
    hub.queue.length = 0;
    const frames = [];
    const stopRecovery = pair.rightEditor.subscribeRecovery((frame) => frames.push(frame));
    hub.replay([messages[1], messages[0]]);
    stopRecovery();
    check('AddSlide→AddShape 逆序到达时按结构依赖链一帧落模',
      pair.right.slides[added]?.children.includes(inserted)
      && pair.right.elements[inserted]?.parent === added
      && frames.length === 2 && frames[0].patches.length === 0
      && semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0,
    errors.map(String).join(' / '));
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('sample-editor-align.pptx', 'collab-group-child-chain-');
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
    const pasted = pair.leftEditor.exec({
      type: 'PasteElements', payload, at: { parentId: groupId, x: 100, y: 100 },
    }).forward.find((patch) => patch.op === 'insert' && patch.path[0] === 'elements').path[1];
    const messages = structuredClone(hub.queue);
    hub.queue.length = 0;
    const frames = [];
    const stopRecovery = pair.rightEditor.subscribeRecovery((frame) => frames.push(frame));
    hub.replay([messages[1], messages[0]]);
    stopRecovery();
    check('Group→PasteElements 逆序到达时新组可作为同帧结构父级',
      pair.right.elements[pasted]?.parent === groupId
      && pair.right.elements[groupId]?.children.includes(pasted)
      && frames.length === 2 && frames[0].patches.length === 0
      && semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0,
    errors.map(String).join(' / '));
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('sample-editor-add-slide.pptx', 'collab-overlap-chain-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const slideId = [...pair.leftEditor.exec({
      type: 'AddSlide', layoutId: pair.left.layoutOrder[0], at: { after: pair.left.slideOrder[0] },
    }).createdSlides][0];
    const add = (preset, x) => pair.leftEditor.exec({
      type: 'AddShape', slideId, preset, rect: { x, y: 10, w: 80, h: 60 },
    }).forward.find((patch) => patch.op === 'insert' && patch.path[0] === 'elements').path[1];
    const first = add('rect', 10);
    const second = add('ellipse', 110);
    const grouped = pair.leftEditor.exec({ type: 'Group', ids: [first, second] });
    const groupId = grouped.forward.find((patch) => patch.path[2] === 'hierarchy')?.path[1];
    const messages = structuredClone(hub.queue);
    hub.queue.length = 0;
    const frames = [];
    const stopRecovery = pair.rightEditor.subscribeRecovery((frame) => frames.push(frame));
    hub.replay(messages.reverse());
    stopRecovery();
    check('新页→新增形状→组合完全逆序时重叠结构快照仍原子收敛',
      pair.right.elements[groupId]?.children.length === 2
      && pair.right.elements[first]?.parent === groupId
      && pair.right.elements[second]?.parent === groupId
      && frames.length === 4 && frames.slice(0, 3).every((frame) => frame.patches.length === 0)
      && bindings[1].checkpoint().deferred.length === 0
      && semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0,
    errors.map(String).join(' / '));
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('sample-editor-add-slide.pptx', 'collab-insert-order-chain-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const slideId = [...pair.leftEditor.exec({
      type: 'AddSlide', layoutId: pair.left.layoutOrder[0], at: { after: pair.left.slideOrder[0] },
    }).createdSlides][0];
    const inserted = pair.leftEditor.exec({
      type: 'AddShape', slideId, preset: 'rect', rect: { x: 10, y: 10, w: 80, h: 60 },
    }).forward.find((patch) => patch.op === 'insert' && patch.path[0] === 'elements').path[1];
    pair.leftEditor.exec({ type: 'SetZ', id: inserted, to: 'back' });
    const messages = structuredClone(hub.queue);
    hub.queue.length = 0;
    hub.replay(messages.reverse());
    check('新页→新增形状→SetZ 完全逆序时结构后字段按顺序验真',
      pair.right.elements[inserted]?.order === pair.left.elements[inserted]?.order
      && bindings[1].checkpoint().deferred.length === 0
      && semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0,
    errors.map(String).join(' / '));
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('sample-editor-move-slide.pptx', 'collab-insert-move-cache-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const originalTail = pair.left.slideOrder.at(-1);
    pair.rightEditor.toSlide(originalTail);
    const duplicated = [...pair.leftEditor.exec({ type: 'DuplicateSlide', id: originalTail }).createdSlides][0];
    pair.leftEditor.exec({ type: 'MoveSlide', id: duplicated, at: { after: null } });
    const messages = structuredClone(hub.queue);
    hub.queue.length = 0;
    hub.replay(messages.reverse());
    check('新增页后续 MoveSlide 会清除旧页动态页码投影缓存',
      JSON.stringify(pair.leftEditor.toSlide(originalTail))
        === JSON.stringify(pair.rightEditor.toSlide(originalTail))
      && semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0,
    errors.map(String).join(' / '));
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('sample-editor-add-slide.pptx', 'collab-structural-order-history-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const slideId = [...pair.leftEditor.exec({
      type: 'AddSlide', layoutId: pair.left.layoutOrder[0], at: { after: pair.left.slideOrder[0] },
    }).createdSlides][0];
    const add = (preset, x) => pair.leftEditor.exec({
      type: 'AddShape', slideId, preset, rect: { x, y: 10, w: 80, h: 60 },
    }).forward.find((patch) => patch.op === 'insert' && patch.path[0] === 'elements').path[1];
    const first = add('rect', 10);
    const second = add('ellipse', 110);
    const grouped = pair.leftEditor.exec({ type: 'Group', ids: [first, second] });
    const groupId = grouped.forward.find((patch) => patch.path[2] === 'hierarchy')?.path[1];
    pair.leftEditor.exec({ type: 'SetZ', id: groupId, to: 'back' });
    pair.leftEditor.exec({ type: 'Ungroup', id: groupId });
    const messages = structuredClone(hub.queue);
    hub.queue.length = 0;
    hub.replay(messages.reverse());
    check('结构批中被后续 Ungroup 删除的中途 SetZ 不阻断全链收敛',
      !pair.right.elements[groupId]
      && pair.right.elements[first]?.parent === slideId
      && pair.right.elements[second]?.parent === slideId
      && bindings[1].checkpoint().deferred.length === 0
      && semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0,
    errors.map(String).join(' / '));
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('sample-editor-add-slide.pptx', 'collab-restore-field-chain-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const slideId = [...pair.leftEditor.exec({
      type: 'AddSlide', layoutId: pair.left.layoutOrder[0], at: { after: pair.left.slideOrder[0] },
    }).createdSlides][0];
    const inserted = pair.leftEditor.exec({
      type: 'AddShape', slideId, preset: 'rect', rect: { x: 10, y: 10, w: 80, h: 60 },
    }).forward.find((patch) => patch.op === 'insert' && patch.path[0] === 'elements').path[1];
    pair.leftEditor.exec({ type: 'RemoveElement', id: inserted });
    pair.leftEditor.undo();
    pair.leftEditor.exec({ type: 'SetXfrm', id: inserted, x: 123 });
    const messages = structuredClone(hub.queue);
    hub.queue.length = 0;
    hub.replay(messages.reverse());
    check('新增元素删除撤销后再改字段，完全逆序仍保留恢复后的字段写入',
      pair.right.elements[inserted]?.ovr.x === 123
      && bindings[1].checkpoint().deferred.length === 0
      && semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0,
    errors.map(String).join(' / '));
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('sample-editor-add-slide.pptx', 'collab-causal-entry-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const baseline = editableShapes(pair.left)[0];
    const previousX = pair.right.elements[baseline.id].ovr.x;
    const slideId = [...pair.leftEditor.exec({
      type: 'AddSlide', layoutId: pair.left.layoutOrder[0], at: { after: pair.left.slideOrder[0] },
    }).createdSlides][0];
    const inserted = pair.leftEditor.exec({
      type: 'AddShape', slideId, preset: 'rect', rect: { x: 10, y: 10, w: 80, h: 60 },
    }).forward.find((patch) => patch.op === 'insert' && patch.path[0] === 'elements').path[1];
    pair.leftEditor.exec({ type: 'SetXfrm', id: baseline.id, x: 139 });
    const messages = structuredClone(hub.queue);
    hub.queue.length = 0;
    hub.replay([messages[1], messages[2]]);
    const laterFieldWaited = pair.right.elements[baseline.id].ovr.x === previousX
      && bindings[1].checkpoint().deferred.length === 2;
    hub.replay([messages[0]]);
    check('同副本前序结构依赖未满足时，新到达的后续基线字段也整条等待',
      laterFieldWaited && pair.right.elements[baseline.id]?.ovr.x === 139
      && pair.right.elements[inserted]?.parent === slideId
      && bindings[1].checkpoint().deferred.length === 0
      && semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0,
    errors.map(String).join(' / '));
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('sample-editor-add-slide.pptx', 'collab-nested-ungroup-order-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const slideId = [...pair.leftEditor.exec({
      type: 'AddSlide', layoutId: pair.left.layoutOrder[0], at: { after: pair.left.slideOrder[0] },
    }).createdSlides][0];
    const add = (preset, x) => pair.leftEditor.exec({
      type: 'AddShape', slideId, preset, rect: { x, y: 10, w: 80, h: 60 },
    }).forward.find((patch) => patch.op === 'insert' && patch.path[0] === 'elements').path[1];
    const first = add('rect', 10);
    const second = add('ellipse', 110);
    const third = add('triangle', 210);
    const innerId = pair.leftEditor.exec({ type: 'Group', ids: [first, second] }).forward
      .find((patch) => patch.path[2] === 'hierarchy')?.path[1];
    const outerId = pair.leftEditor.exec({ type: 'Group', ids: [innerId, third] }).forward
      .find((patch) => patch.path[2] === 'hierarchy')?.path[1];
    pair.leftEditor.exec({ type: 'SetZ', id: innerId, to: 'front' });
    pair.leftEditor.exec({ type: 'Ungroup', id: outerId });
    pair.leftEditor.exec({ type: 'Ungroup', id: innerId });
    const messages = structuredClone(hub.queue);
    hub.queue.length = 0;
    hub.replay(messages.reverse());
    check('嵌套组合的中途层序与连续解组完全逆序仍清理两层容器',
      !pair.right.elements[innerId] && !pair.right.elements[outerId]
      && pair.right.elements[first]?.parent === slideId
      && pair.right.elements[second]?.parent === slideId
      && pair.right.elements[third]?.parent === slideId
      && bindings[1].checkpoint().deferred.length === 0
      && semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0,
    errors.map(String).join(' / '));
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('showcase.pptx', 'collab-sequence-gap-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const byParent = new Map();
    for (const record of editableShapes(pair.left)) {
      byParent.set(record.parent, [...(byParent.get(record.parent) ?? []), record]);
    }
    const [first, second, third] = [...byParent.values()]
      .find((records) => records.length >= 3).slice(0, 3);
    const innerId = pair.leftEditor.exec({ type: 'Group', ids: [first.id, second.id] }).forward
      .find((patch) => patch.path[2] === 'hierarchy')?.path[1];
    const outerId = pair.leftEditor.exec({ type: 'Group', ids: [innerId, third.id] }).forward
      .find((patch) => patch.path[2] === 'hierarchy')?.path[1];
    pair.leftEditor.exec({ type: 'SetZ', id: innerId, to: 'front' });
    pair.leftEditor.exec({ type: 'Ungroup', id: outerId });
    pair.leftEditor.exec({ type: 'Ungroup', id: innerId });
    const messages = structuredClone(hub.queue);
    hub.queue.length = 0;
    hub.replay([messages[0], messages[1], messages[4], messages[2]]);
    const gapStillWaited = !!pair.right.elements[innerId] && !!pair.right.elements[outerId]
      && bindings[1].checkpoint().deferred.length === 1;
    hub.replay([messages[3]]);
    check('自包含结构消息暂存后也不能越过仍缺失的同副本 sequence',
      gapStillWaited && !pair.right.elements[innerId] && !pair.right.elements[outerId]
      && !pair.right.removedElements[innerId] && !pair.right.removedElements[outerId]
      && bindings[1].checkpoint().deferred.length === 0
      && semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0,
    errors.map(String).join(' / '));
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const bytes = load('showcase.pptx');
    const pair = await createPair('showcase.pptx', 'collab-move-frame-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const frames = [];
    let checkpoint;
    const stopRecovery = pair.rightEditor.subscribeRecovery((frame) => {
      frames.push(frame);
      checkpoint = bindings[1].checkpoint();
    });
    const [leftMoved, rightMoved] = pair.left.slideOrder;
    const tail = pair.left.slideOrder.at(-1);
    pair.leftEditor.exec({ type: 'MoveSlide', id: leftMoved, at: { after: tail } });
    pair.rightEditor.exec({ type: 'MoveSlide', id: rightMoved, at: { after: tail } });
    hub.flush();
    stopRecovery();
    const presentation = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
    const restoredDoc = edit.createDoc(presentation, { idPrefix: 'collab-move-frame-' });
    const restoredEditor = new edit.Editor(restoredDoc, { recoveryFrames: frames });
    let restoredBinding;
    let restoreError;
    try {
      restoredBinding = collab.bindCollaboration(restoredEditor, {
        documentId: 'deck', replicaId: 'b', replicaSlot: 2,
        provider: { send() {}, subscribe() { return () => {}; } }, checkpoint,
      });
    } catch (error) { restoreError = error; }
    check('并发 MoveSlide 的远端最终页序只增加一帧 recovery，崩溃恢复即最终态',
      frames.length === 2 && !restoreError
      && JSON.stringify(restoredDoc.slideOrder) === JSON.stringify(pair.right.slideOrder)
      && semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0,
    errors.map(String).join(' / '));
    restoredBinding?.dispose();
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const bytes = load('showcase.pptx');
    const pair = await createPair('showcase.pptx', 'collab-deferred-frame-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const frames = [];
    const checkpoints = [];
    const stopRecovery = pair.rightEditor.subscribeRecovery((frame) => {
      frames.push(frame);
      checkpoints.push(bindings[1].checkpoint());
    });
    const inserted = pair.leftEditor.exec({
      type: 'AddShape', slideId: pair.left.slideOrder[0], preset: 'rect',
      rect: { x: 10, y: 10, w: 80, h: 60 },
    }).forward.find((patch) => patch.op === 'insert' && patch.path[0] === 'elements').path[1];
    pair.leftEditor.exec({ type: 'SetXfrm', id: inserted, x: 432 });
    const messages = structuredClone(hub.queue);
    hub.queue.length = 0;
    hub.replay([messages[1]]);
    hub.replay([messages[0]]);
    stopRecovery();
    const crashFrames = frames.slice(0, 2);
    const crashCheckpoint = checkpoints[1];
    const deferredPersisted = frames[0].patches.length === 0
      && frames.length === 2 && crashCheckpoint.deferred.length === 0;
    bindings.forEach((binding) => binding.dispose());

    const presentation = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
    const restoredDoc = edit.createDoc(presentation, { idPrefix: 'collab-deferred-frame-' });
    const restoredEditor = new edit.Editor(restoredDoc, { recoveryFrames: crashFrames });
    const restoredHub = new OfflineHub();
    const restoredErrors = [];
    const resumedFrames = [];
    const stopResumedRecovery = restoredEditor.subscribeRecovery((frame) => resumedFrames.push(frame));
    const restored = collab.bindCollaboration(restoredEditor, {
      documentId: 'deck', replicaId: 'b', replicaSlot: 2, checkpoint: crashCheckpoint,
      provider: restoredHub.endpoint('b'), onError: (error) => restoredErrors.push(error),
    });
    restoredHub.replay(messages);
    stopResumedRecovery();
    check('依赖消息与 newly-ready deferred 合成一帧，崩溃恢复与旧消息重放幂等',
      deferredPersisted && restoredDoc.elements[inserted]?.ovr.x === 432
      && resumedFrames.length === 0 && restored.checkpoint().deferred.length === 0
      && errors.length === 0 && restoredErrors.length === 0,
    [...errors, ...restoredErrors].map(String).join(' / '));
    restored.dispose();
  }

}
