const createdElement = (result) => result.forward.find((patch) =>
  patch.op === 'insert' && patch.path[0] === 'elements')?.path[1];

export async function runCollabProtocolContract({
  bindPair, check, collab, core, createPair, edit, editableShapes, load, OfflineHub,
  semanticDoc, stringDiff,
}) {
  console.log('\n\x1b[36m▸ 原子消息、页序意图与协议边界\x1b[0m');
  {
    const pair = await createPair('showcase.pptx', 'collab-last-move-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const [first, second, moved] = [pair.left.slideOrder[0], pair.left.slideOrder[1],
      pair.left.slideOrder.at(-1)];
    pair.leftEditor.exec(
      { type: 'MoveSlide', id: moved, at: { after: null } },
      { type: 'MoveSlide', id: moved, at: { after: second } },
    );
    hub.flush();
    check('同一消息内连续移动同页按末次 intent 收敛', pair.left.slideOrder.indexOf(moved)
      === pair.left.slideOrder.indexOf(second) + 1
      && JSON.stringify(pair.left.slideOrder) === JSON.stringify(pair.right.slideOrder)
      && pair.left.slideOrder[0] === first && errors.length === 0);
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('showcase.pptx', 'collab-move-ordinal-');
    const hub = new OfflineHub();
    const bindings = bindPair(pair, hub);
    const [leftMoved, rightMoved] = pair.left.slideOrder;
    const tail = pair.left.slideOrder.at(-1);
    pair.leftEditor.exec({ type: 'MoveSlide', id: leftMoved, at: { after: tail } });
    pair.rightEditor.exec({ type: 'MoveSlide', id: rightMoved, at: { after: tail } });
    hub.flush((items) => items.reverse());
    pair.leftEditor.exec(
      { type: 'MoveSlide', id: leftMoved, at: { after: null } },
      { type: 'MoveSlide', id: rightMoved, at: { after: null } },
    );
    hub.flush();
    check('同 stamp 的多页 intent 用消息 ordinal 全序而不依赖 Map 插入史',
      pair.left.slideOrder[0] === rightMoved && pair.left.slideOrder[1] === leftMoved
      && JSON.stringify(pair.left.slideOrder) === JSON.stringify(pair.right.slideOrder));
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('sample-editor-add-slide.pptx', 'collab-slide-id-bound-');
    const provider = { send() {}, subscribe() { return () => {}; } };
    const binding = collab.bindCollaboration(pair.leftEditor, {
      documentId: 'slide-id-bound', replicaId: 'highest-slot', replicaSlot: 4095, provider,
    });
    const slideId = [...pair.leftEditor.exec({
      type: 'AddSlide', layoutId: pair.left.layoutOrder[0], at: { after: pair.left.slideOrder[0] },
    }).createdSlides][0];
    check('最高 slot 的 presentation slide id 仍满足 ST_SlideId 上界',
      pair.left.slides[slideId].creation.presentationSlideId <= 0x7fff_ffff);
    binding.dispose();
  }

  {
    const input = load('showcase.pptx');
    const pair = await createPair('showcase.pptx', 'collab-remote-checkpoint-');
    const hub = new OfflineHub();
    const bindings = bindPair(pair, hub);
    const frames = [];
    let checkpoint;
    const stopRecovery = pair.leftEditor.subscribeRecovery((frame) => {
      frames.push(frame);
      checkpoint = bindings[0].checkpoint();
    });
    const target = editableShapes(pair.right)[0];
    pair.rightEditor.exec({ type: 'SetXfrm', id: target.id, x: target.src.x + 31 });
    const replay = structuredClone(hub.queue);
    hub.flush();
    stopRecovery();
    const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const restoredDoc = edit.createDoc(presentation, { idPrefix: 'collab-remote-checkpoint-' });
    const restoredEditor = new edit.Editor(restoredDoc, { recoveryFrames: frames });
    const restoredHub = new OfflineHub();
    const restored = collab.bindCollaboration(restoredEditor, {
      documentId: 'deck', replicaId: 'a', replicaSlot: 1,
      provider: restoredHub.endpoint('a'), checkpoint,
    });
    restoredHub.replay(replay);
    check('远端 recovery 回调内 checkpoint 已原子包含 register 与 seen',
      checkpoint.registers.length > 0
      && checkpoint.seen.some((entry) => entry.replicaId === 'b' && entry.contiguous >= 1)
      && restoredDoc.elements[target.id].ovr.x === target.src.x + 31);
    restored.dispose();
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('showcase.pptx', 'collab-seen-watermark-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const target = editableShapes(pair.right)[0];
    pair.rightEditor.exec({ type: 'SetXfrm', id: target.id, x: target.src.x + 1 });
    const template = structuredClone(hub.queue[0]);
    hub.queue.length = 0;
    const replay = Array.from({ length: 200 }, (_, offset) => {
      const item = structuredClone(template);
      const sequence = offset + 1;
      item.message.sequence = sequence;
      item.message.stamp.clock = sequence;
      item.message.identity.allocation.clock = sequence;
      item.message.identity.allocation.sequence = sequence;
      return item;
    }).reverse();
    hub.replay(replay);
    const seen = bindings[0].checkpoint().seen.find((entry) => entry.replicaId === 'b');
    check('乱序 seen 集在缺口闭合后压成副本连续高水位',
      seen?.contiguous === 200 && seen.sparse.length === 0 && errors.length === 0,
    errors.map(String).join(' / '));
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const input = load('showcase.pptx');
    const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const doc = edit.createDoc(presentation, { idPrefix: 'collab-atomic-checkpoint-' });
    const editor = new edit.Editor(doc);
    const frames = [];
    let checkpoint;
    const stopRecovery = editor.subscribeRecovery((frame) => {
      frames.push(frame);
      checkpoint = binding.checkpoint();
    });
    const binding = collab.bindCollaboration(editor, {
      documentId: 'atomic-checkpoint', replicaId: 'a', replicaSlot: 1,
      provider: { send() {}, subscribe() { return () => {}; } },
    });
    const target = editableShapes(doc)[0];
    editor.exec({ type: 'SetXfrm', id: target.id, x: target.src.x + 19 });
    stopRecovery();
    const restoredPresentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
    const restoredDoc = edit.createDoc(restoredPresentation, { idPrefix: 'collab-atomic-checkpoint-' });
    const restoredEditor = new edit.Editor(restoredDoc, { recoveryFrames: frames });
    let restoredBinding;
    let restoreError;
    try {
      restoredBinding = collab.bindCollaboration(restoredEditor, {
        documentId: 'atomic-checkpoint', replicaId: 'a', replicaSlot: 1, checkpoint,
        provider: { send() {}, subscribe() { return () => {}; } },
      });
    } catch (error) { restoreError = error; }
    check('recovery 回调内取得的 checkpoint 与同帧原子匹配', !restoreError
      && checkpoint.clock === frames.at(-1).identity.allocation.clock
      && checkpoint.sequence === frames.at(-1).identity.allocation.sequence);
    restoredBinding?.dispose();
    binding.dispose();
  }

  {
    const pair = await createPair('showcase.pptx', 'collab-invalid-move-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const before = JSON.stringify(pair.right.slideOrder);
    pair.leftEditor.exec({
      type: 'MoveSlide', id: pair.left.slideOrder.at(-1), at: { after: null },
    });
    const poisoned = structuredClone(hub.queue[0]);
    poisoned.message.patches[0].value.after = 42;
    hub.queue.length = 0;
    hub.replay([poisoned]);
    check('非法 MoveSlide 锚点由 Editor 整批验真并通过 onError 隔离',
      JSON.stringify(pair.right.slideOrder) === before && errors.length === 1);
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('showcase.pptx', 'collab-insert-field-atomic-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const slideId = pair.left.slideOrder[0];
    const inserted = createdElement(pair.leftEditor.exec({
      type: 'AddShape', slideId, preset: 'rect', rect: { x: 10, y: 10, w: 80, h: 60 },
    }));
    pair.leftEditor.exec({ type: 'SetXfrm', id: inserted, x: 246 });
    const [insertion, field] = structuredClone(hub.queue);
    const combined = structuredClone(insertion);
    combined.message.patches = [...insertion.message.patches, ...field.message.patches];
    hub.queue.length = 0;
    const frames = [];
    const stopRecovery = pair.rightEditor.subscribeRecovery((frame) => frames.push(frame));
    hub.replay([combined]);
    stopRecovery();
    check('同消息 AddShape 与新目标 SetXfrm 折叠为单帧 recovery',
      pair.right.elements[inserted]?.ovr.x === 246 && frames.length === 1 && errors.length === 0,
    errors.map(String).join(' / '));
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('showcase.pptx', 'collab-insert-del-atomic-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const slideId = pair.left.slideOrder[0];
    const inserted = createdElement(pair.leftEditor.exec({
      type: 'AddShape', slideId, preset: 'rect', rect: { x: 10, y: 10, w: 80, h: 60 },
    }));
    pair.leftEditor.exec({ type: 'SetName', id: inserted, name: '临时名称' });
    pair.leftEditor.exec({ type: 'SetName', id: inserted, name: null });
    const messages = structuredClone(hub.queue);
    const combined = structuredClone(messages[0]);
    combined.message.patches = messages.flatMap((item) => item.message.patches);
    hub.queue.length = 0;
    const frames = [];
    const stopRecovery = pair.rightEditor.subscribeRecovery((frame) => frames.push(frame));
    hub.replay([combined]);
    stopRecovery();
    check('同消息新建目标的 set→del 末次意图仍只落一帧 recovery',
      pair.right.elements[inserted] && pair.right.elements[inserted].ovr.name === undefined
      && frames.length === 1 && errors.length === 0,
    errors.map(String).join(' / '));
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('sample-editor-align.pptx', 'collab-group-field-atomic-');
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
    pair.leftEditor.exec({ type: 'SetXfrm', id: groupId, x: 357 });
    const [hierarchy, field] = structuredClone(hub.queue);
    const combined = structuredClone(hierarchy);
    combined.message.patches = [...hierarchy.message.patches, ...field.message.patches];
    hub.queue.length = 0;
    const frames = [];
    const stopRecovery = pair.rightEditor.subscribeRecovery((frame) => frames.push(frame));
    hub.replay([combined]);
    stopRecovery();
    check('同消息 Group 与新组 SetXfrm 折叠为单帧 recovery',
      pair.right.elements[groupId]?.ovr.x === 357 && frames.length === 1 && errors.length === 0,
    errors.map(String).join(' / '));
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('showcase.pptx', 'collab-deferred-atomic-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const slideId = pair.left.slideOrder[0];
    const inserted = createdElement(pair.leftEditor.exec({
      type: 'AddShape', slideId, preset: 'rect', rect: { x: 10, y: 10, w: 80, h: 60 },
    }));
    const existing = editableShapes(pair.left).find((record) => record.id !== inserted);
    pair.leftEditor.exec(
      { type: 'SetXfrm', id: existing.id, x: 222 },
      { type: 'SetXfrm', id: inserted, y: 333 },
    );
    const messages = structuredClone(hub.queue).sort((left, right) =>
      right.message.sequence - left.message.sequence);
    messages[0].message.patches.find((patch) => patch.path.at(-1) === 'y').value = '坏值';
    hub.queue.length = 0;
    hub.replay(messages);
    check('延迟消息按原批次验真，任一字段非法时不会部分落模',
      pair.right.elements[existing.id]?.ovr.x !== 222 && pair.right.elements[inserted]
      && errors.length === 1);
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('showcase.pptx', 'collab-deferred-isolation-');
    const hub = new OfflineHub();
    const errors = [];
    const bindings = bindPair(pair, hub, errors);
    const slideId = pair.left.slideOrder[0];
    const inserted = createdElement(pair.leftEditor.exec({
      type: 'AddShape', slideId, preset: 'rect', rect: { x: 10, y: 10, w: 80, h: 60 },
    }));
    pair.leftEditor.exec({ type: 'SetXfrm', id: inserted, x: 222 });
    pair.leftEditor.exec({ type: 'SetXfrm', id: inserted, w: 90 });
    const messages = structuredClone(hub.queue);
    messages[2].message.patches.find((patch) => patch.path.at(-1) === 'w').value = -1;
    hub.queue.length = 0;
    hub.replay([messages[1], messages[2], messages[0]]);
    const checkpoint = bindings[1].checkpoint();
    hub.replay(messages);
    check('多个 deferred 同时就绪时只隔离坏消息，合法字段仍落模且重放幂等',
      pair.right.elements[inserted]?.ovr.x === 222
      && pair.right.elements[inserted]?.ovr.w !== -1
      && checkpoint.deferred.length === 0 && errors.length === 1,
    errors.map(String).join(' / '));
    bindings.forEach((binding) => binding.dispose());
  }

  {
    const pair = await createPair('showcase.pptx', 'collab-dispose-generation-');
    let captured;
    let outgoing;
    const leftBinding = collab.bindCollaboration(pair.leftEditor, {
      documentId: 'dispose', replicaId: 'a', replicaSlot: 1,
      provider: { send() {}, subscribe(listener) { captured = listener; return () => {}; } },
    });
    const rightBinding = collab.bindCollaboration(pair.rightEditor, {
      documentId: 'dispose', replicaId: 'b', replicaSlot: 2,
      provider: { send(message) { outgoing = structuredClone(message); }, subscribe() { return () => {}; } },
    });
    const target = editableShapes(pair.right)[0];
    pair.rightEditor.exec({ type: 'SetXfrm', id: target.id, x: target.src.x + 27 });
    leftBinding.dispose();
    captured(outgoing);
    check('dispose 后已捕获的 provider 回调也不能再修改文档',
      pair.left.elements[target.id].ovr.x !== target.src.x + 27);
    rightBinding.dispose();
  }
}
