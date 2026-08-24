/** 层级命令只从公开 Editor、投影、历史与 JSON patch 观察行为。 */
export async function runElementLayerContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ SetZ 元素层级\x1b[0m');
  const bytes = load('sample-editor-delete.pptx');
  const pres = await core.parse(bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(pres, { idPrefix: 'layer-' });
  const editor = new edit.Editor(doc);
  const slideId = doc.slideOrder[0];
  const target = Object.values(doc.elements).find((record) => record.src.name === 'delete-shape');
  const sourceZ = target.z;
  const sourceOrder = [...doc.slides[slideId].children];
  editor.select({ kind: 'elements', ids: [target.id], enteredGroup: null });
  let layerChange;
  const unsubscribe = editor.subscribe((change) => { layerChange = change; });

  const moved = editor.exec({ type: 'SetZ', id: target.id, to: 'front' });
  unsubscribe();
  check('SetZ 置顶只写稀疏顺序并立即改变公开投影',
    doc.slides[slideId].children.at(-1) === target.id
      && editor.toSlide(slideId).elements.at(-1)?.name === 'delete-shape'
      && target.z === sourceZ && Object.hasOwn(target, 'order')
      && moved.forward.length === 1 && moved.forward[0].path.join('.') === `elements.${target.id}.order`
      && layerChange?.touchedElements.has(target.id)
      && layerChange?.reorderedElements.has(target.id) && layerChange.renderElements.size === 0
      && editor.history.undoCount === 1 && editor.isDirty());

  editor.undo();
  check('撤销层级恢复来源序、选区和干净状态',
    doc.slides[slideId].children.join(',') === sourceOrder.join(',')
      && !Object.hasOwn(target, 'order')
      && editor.selection.kind === 'elements' && editor.selection.ids.join(',') === target.id
      && editor.history.undoCount === 0 && editor.history.redoCount === 1 && !editor.isDirty());
  editor.redo();
  check('重做层级可由 JSON 双向 patch 确定回放',
    doc.slides[slideId].children.at(-1) === target.id
      && JSON.stringify(editor.history.undoEntries[0]).includes('SetZ')
      && JSON.stringify(moved.forward).includes('order'));
  edit.disposeDoc(doc);

  const multiPres = await core.parse(bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const multiDoc = edit.createDoc(multiPres, { idPrefix: 'layer-multi-' });
  const multiEditor = new edit.Editor(multiDoc);
  const multiSlide = multiDoc.slideOrder[0];
  const byName = (name) => Object.values(multiDoc.elements)
    .find((record) => record.src.name === name);
  const names = () => multiDoc.slides[multiSlide].children
    .map((id) => multiDoc.elements[id].src.name);
  const group = byName('delete-group');
  const frame = byName('delete-frame');
  const picture = byName('delete-picture');
  const shape = byName('delete-shape');
  const peer = byName('delete-peer');
  const childA = byName('delete-group-child-a');
  const childB = byName('delete-group-child-b');
  const initialNames = names();

  multiEditor.transaction((transaction) => {
    transaction.exec({ type: 'SetZ', id: group.id, to: 'front' });
    transaction.exec({ type: 'SetZ', id: frame.id, to: 'front' });
  }, '多选置顶');
  check('同父级多元素置顶保持相对次序并只形成一个历史事务',
    names().slice(-2).join(',') === 'delete-group,delete-frame'
      && multiEditor.history.undoCount === 1
      && multiEditor.history.undoEntries[0].forward.length === 2);
  multiEditor.undo();
  check('撤销多元素层级一次恢复全部来源序与稀疏状态',
    names().join(',') === initialNames.join(',')
      && !Object.hasOwn(group, 'order') && !Object.hasOwn(frame, 'order')
      && !multiEditor.isDirty());

  multiEditor.transaction((transaction) => {
    transaction.exec({ type: 'SetZ', id: frame.id, to: 'forward' });
    transaction.exec({ type: 'SetZ', id: picture.id, to: 'forward' });
  }, '多选上移一层');
  check('连续相邻多选可整体上移一层而不反转',
    names().slice(0, 5).join(',')
      === 'delete-shape,delete-group,delete-placeholder-filled,delete-picture,delete-frame');
  multiEditor.undo();

  multiEditor.exec({ type: 'SetZ', id: childA.id, to: 'front' });
  check('组合内元素独立重排且框架对象可参与顶层层级',
    multiDoc.elements[group.id].children.join(',') === [childB.id, childA.id].join(','));
  multiEditor.undo();
  const beforeBoundaryHistory = multiEditor.history.undoCount;
  const boundary = multiEditor.exec({ type: 'SetZ', id: peer.id, to: 'front' });
  check('已经位于边界的层级命令不创建 patch、历史或 dirty',
    boundary.forward.length === 0 && multiEditor.history.undoCount === beforeBoundaryHistory
      && !Object.hasOwn(peer, 'order') && !multiEditor.isDirty());

  const beforeCrossParent = structuredClone(multiDoc);
  let crossParentRejected = false;
  try {
    multiEditor.transaction((transaction) => {
      transaction.exec({ type: 'SetZ', id: shape.id, to: 'front' });
      transaction.exec({ type: 'SetZ', id: childA.id, to: 'front' });
    }, '跨父级层级');
  } catch {
    crossParentRejected = JSON.stringify(multiDoc) === JSON.stringify(beforeCrossParent)
      && multiEditor.history.undoCount === 0 && !multiEditor.isDirty();
  }
  check('跨父级层级事务在落模前整体拒绝', crossParentRejected);

  const patchDoc = structuredClone(multiDoc);
  const patchBefore = JSON.stringify(patchDoc);
  const patchTarget = patchDoc.elements[shape.id];
  const patchSibling = patchDoc.elements[patchDoc.slides[multiSlide].children[1]];
  let duplicatePatchRejected = false;
  try {
    edit.applyPatches(patchDoc, [{
      op: 'set', path: ['elements', patchTarget.id, 'order'],
      value: edit.elementOrder(patchSibling), origin: 'malformed',
    }]);
  } catch {
    duplicatePatchRejected = JSON.stringify(patchDoc) === patchBefore;
  }
  let invalidPathRejected = false;
  try {
    edit.applyPatches(patchDoc, [{
      op: 'set', path: ['garbage', patchTarget.id, 'order'],
      value: edit.elementOrder(patchTarget), origin: 'malformed',
    }]);
  } catch {
    invalidPathRejected = JSON.stringify(patchDoc) === patchBefore;
  }
  let invalidTargetRejected = false;
  try { multiEditor.exec({ type: 'SetZ', id: shape.id, to: 'sideways' }); } catch {
    invalidTargetRejected = true;
  }
  shape.meta.locked = true;
  let lockedRejected = false;
  try { multiEditor.exec({ type: 'SetZ', id: shape.id, to: 'front' }); } catch {
    lockedRejected = true;
  }
  shape.meta.locked = false;
  const missingOriginDoc = structuredClone(multiDoc);
  delete missingOriginDoc.elements[shape.id].meta.origin;
  const missingOriginEditor = new edit.Editor(missingOriginDoc);
  const missingOriginBefore = JSON.stringify(missingOriginDoc);
  let missingOriginRejected = false;
  try { missingOriginEditor.exec({ type: 'SetZ', id: shape.id, to: 'front' }); } catch {
    missingOriginRejected = JSON.stringify(missingOriginDoc) === missingOriginBefore;
  }
  check('非法层级 patch 路径/值、未知目标与 locked 边界均在修改模型前拒绝',
    duplicatePatchRejected && invalidPathRejected && invalidTargetRejected && lockedRejected && missingOriginRejected
      && multiEditor.history.undoCount === 0 && !multiEditor.isDirty());
  edit.disposeDoc(multiDoc);

  const coverageBytes = load('sample-editor-layer.pptx');
  const coveragePres = await core.parse(coverageBytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const coverageDoc = edit.createDoc(coveragePres, { idPrefix: 'layer-coverage-' });
  const coverageEditor = new edit.Editor(coverageDoc);
  const records = Object.values(coverageDoc.elements);
  const inherited = records.find((record) => record.src.name === 'layer-inherited');
  const link = records.find((record) => record.src.name === 'layer-link');
  const coverageFrame = records.find((record) => record.src.name === 'layer-frame');
  const writableTop = coverageDoc.slides[coverageDoc.slideOrder[0]].children
    .map((id) => coverageDoc.elements[id])
    .filter((record) => record.meta.editable !== 'none');
  check('确定性层级固件覆盖 60 个可写顶层、超链接、frame 与版式只读投影',
    writableTop.length === 60 && inherited?.meta.editable === 'none'
      && inherited.meta.origin?.part === 'ppt/slideLayouts/slideLayout1.xml'
      && link?.src.link === 'https://example.com/layer'
      && coverageFrame?.meta.editable === 'frame');
  const inheritedIndex = coverageDoc.slides[coverageDoc.slideOrder[0]].children.indexOf(inherited.id);
  coverageEditor.exec({ type: 'SetZ', id: link.id, to: 'back' });
  const afterInheritedIndex = coverageDoc.slides[coverageDoc.slideOrder[0]].children.indexOf(inherited.id);
  let inheritedRejected = false;
  try { coverageEditor.exec({ type: 'SetZ', id: inherited.id, to: 'front' }); } catch {
    inheritedRejected = true;
  }
  coverageDoc.meta.readonly = true;
  let readonlyRejected = false;
  try { coverageEditor.exec({ type: 'SetZ', id: coverageFrame.id, to: 'front' }); } catch {
    readonlyRejected = true;
  }
  coverageDoc.meta.readonly = false;
  check('层级只重排同 part 可写槽位，继承投影固定且不能成为命令目标',
    inheritedIndex === afterInheritedIndex && inheritedRejected && readonlyRejected
      && coverageEditor.history.undoCount === 1);

  coverageEditor.undo();
  const fixed = records.find((record) => record.src.name === 'layer-item-01');
  const left = records.find((record) => record.src.name === 'layer-back');
  const right = records.find((record) => record.src.name === 'layer-item-02');
  fixed.meta.editable = 'none';
  const fixedBefore = coverageDoc.slides[coverageDoc.slideOrder[0]].children.indexOf(fixed.id);
  coverageEditor.exec({ type: 'SetZ', id: left.id, to: 'forward' });
  const fixedAfter = coverageDoc.slides[coverageDoc.slideOrder[0]].children.indexOf(fixed.id);
  const fixedWindow = coverageDoc.slides[coverageDoc.slideOrder[0]].children.slice(fixedAfter - 1, fixedAfter + 2);
  check('夹在可写元素间的只读宿主保留槽位，跨槽元素承担最小稀疏覆盖',
    fixedAfter === fixedBefore && fixedWindow.join(',') === [right.id, fixed.id, left.id].join(',')
      && Object.hasOwn(left, 'order') && Object.hasOwn(right, 'order')
      && !Object.hasOwn(fixed, 'order'));
  coverageEditor.undo();
  const structuralBefore = JSON.stringify(coverageDoc);
  let structuralMixRejected = false;
  try {
    coverageEditor.transaction((transaction) => {
      transaction.exec({ type: 'SetZ', id: left.id, to: 'forward' });
      transaction.exec({ type: 'RemoveElement', id: right.id });
    }, '层级与潜在兄弟删除');
  } catch {
    structuralMixRejected = JSON.stringify(coverageDoc) === structuralBefore
      && coverageEditor.history.undoCount === 0 && !coverageEditor.isDirty();
  }
  check('层级与可能承担顺序覆盖的兄弟删除在落模前整体拒绝', structuralMixRejected);
  fixed.meta.editable = 'full';

  const front = records.find((record) => record.src.name === 'layer-front');
  coverageEditor.transaction((transaction) => {
    transaction.exec({ type: 'SetZ', id: left.id, to: 'front' });
    transaction.exec({ type: 'SetZ', id: front.id, to: 'front' });
  }, '含边界元素的多选置顶');
  const finalWritable = coverageDoc.slides[coverageDoc.slideOrder[0]].children
    .filter((id) => coverageDoc.elements[id].meta.editable !== 'none');
  check('多选最终位置未变的边界元素不承担冗余顺序覆盖',
    finalWritable.slice(-2).join(',') === [left.id, front.id].join(',')
      && Object.hasOwn(left, 'order') && !Object.hasOwn(front, 'order')
      && coverageEditor.history.undoEntries.at(-1).forward.length === 1);
  coverageEditor.undo();

  const sourceChildren = [...coverageDoc.slides[coverageDoc.slideOrder[0]].children];
  const sourceX = coverageEditor.effectiveElement(front.id).x;
  coverageEditor.transaction((transaction) => {
    transaction.exec({ type: 'SetZ', id: left.id, to: 'front' });
    transaction.exec({ type: 'SetXfrm', id: front.id, x: sourceX + 1 });
    transaction.exec({ type: 'SetZ', id: fixed.id, to: 'front' });
  }, '混合层级与变换');
  let mixedUndo = false;
  try {
    coverageEditor.undo();
    mixedUndo = coverageDoc.slides[coverageDoc.slideOrder[0]].children.join(',') === sourceChildren.join(',')
      && coverageEditor.effectiveElement(front.id).x === sourceX && !coverageEditor.isDirty();
  } catch {}
  check('混合事务内重复层级路径仍能一次撤销到事务前状态', mixedUndo);
  edit.disposeDoc(coverageDoc);
}
