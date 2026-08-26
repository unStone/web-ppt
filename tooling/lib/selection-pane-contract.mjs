/** 选择窗格只从公开查询、命令、历史与投影观察模型行为。 */
export async function runSelectionPaneContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 选择窗格目录与重命名\x1b[0m');
  const paneBytes = load('sample-editor-selection-pane.pptx');
  const panePresentation = await core.parse(paneBytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const paneDoc = edit.createDoc(panePresentation, { idPrefix: 'selection-fixture-' });
  const paneItems = edit.querySelectionPane(paneDoc, paneDoc.slideOrder[0]);
  const outer = paneItems.find((item) => item.name === 'pane-outer-group');
  const inner = paneItems.find((item) => item.name === 'pane-inner-group');
  const nested = paneItems.find((item) => item.name === 'pane-child');
  check('确定性固件覆盖重名、特殊名、两级组合、未知框架与跨页目录',
    paneDoc.slideOrder.length === 2
      && paneItems.filter((item) => item.name === 'pane-duplicate').length === 2
      && paneItems.some((item) => item.name === '对象 & <一>')
      && outer?.depth === 0 && inner?.parentId === outer.id && inner.depth === 1
      && nested?.parentId === inner.id && nested.depth === 2
      && paneItems.some((item) => item.editable === 'frame' && item.name === 'pane-unknown-frame')
      && edit.querySelectionPane(paneDoc, paneDoc.slideOrder[1])[0]?.name === 'pane-second-slide');
  edit.disposeDoc(paneDoc);

  const bytes = load('sample-editor-layer.pptx');
  const presentation = await core.parse(bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'selection-pane-' });
  const editor = new edit.Editor(doc);
  const slideId = doc.slideOrder[0];
  const initial = edit.querySelectionPane(doc, slideId);
  const group = initial.find((item) => item.name === 'layer-group');
  const childNames = initial.filter((item) => item.parentId === group?.id).map((item) => item.name);
  check('目录按绘制序自顶向下展开当前页稳定元素树',
    initial[0]?.name === 'layer-front'
      && initial.at(-2)?.name === 'layer-back' && initial.at(-1)?.name === 'layer-inherited'
      && group?.depth === 0 && group.hasChildren
      && childNames.join(',') === 'layer-child-b,layer-child-a'
      && new Set(initial.map((item) => item.id)).size === initial.length);

  const target = initial.find((item) => item.name === 'layer-item-01');
  let change;
  const unsubscribe = editor.subscribe((value) => { change = value; });
  const result = editor.exec({ type: 'SetName', id: target.id, name: '封面标题 & <一>' });
  unsubscribe();
  const renamed = edit.querySelectionPane(doc, slideId).find((item) => item.id === target.id);
  check('SetName 形成稀疏可恢复覆盖并只通知目录与目标渲染分区',
    result.forward.length === 1
      && result.forward[0].path.join('.') === `elements.${target.id}.ovr.name`
      && renamed?.name === '封面标题 & <一>' && renamed.sourceName === 'layer-item-01'
      && renamed.direct && editor.effectiveElement(target.id).name === '封面标题 & <一>'
      && change?.paneElements.has(target.id) && change.renderElements.has(target.id)
      && editor.history.undoCount === 1 && editor.isDirty());

  editor.undo();
  check('撤销重命名恢复来源名称、选区与干净状态',
    edit.querySelectionPane(doc, slideId).find((item) => item.id === target.id)?.name === 'layer-item-01'
      && !Object.hasOwn(doc.elements[target.id].ovr, 'name')
      && !editor.isDirty() && editor.history.redoCount === 1);
  editor.redo();
  editor.exec({ type: 'SetName', id: target.id, name: null });
  check('显式 null 恢复来源且重复恢复严格 no-op',
    !Object.hasOwn(doc.elements[target.id].ovr, 'name')
      && editor.exec({ type: 'SetName', id: target.id, name: null }).forward.length === 0);

  edit.disposeDoc(doc);

  console.log('\n\x1b[36m▸ 选择窗格会话锁定与隐藏\x1b[0m');
  const statePresentation = await core.parse(bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const stateDoc = edit.createDoc(statePresentation, { idPrefix: 'selection-state-' });
  const stateEditor = new edit.Editor(stateDoc);
  const stateSlide = stateDoc.slideOrder[0];
  const records = Object.values(stateDoc.elements);
  const stateGroup = records.find((record) => record.src.name === 'layer-group');
  const child = records.find((record) => record.src.name === 'layer-child-a');
  const sibling = records.find((record) => record.src.name === 'layer-child-b');
  stateEditor.select({ kind: 'elements', ids: [child.id], enteredGroup: stateGroup.id });
  let stateChange;
  const unsubscribeState = stateEditor.subscribe((value) => { stateChange = value; });
  const locked = stateEditor.exec({ type: 'SetLocked', id: stateGroup.id, locked: true });
  unsubscribeState();
  const lockedItems = edit.querySelectionPane(stateDoc, stateSlide);
  const lockedGroup = lockedItems.find((item) => item.id === stateGroup.id);
  const lockedChild = lockedItems.find((item) => item.id === child.id);
  let transformRejected = false;
  let renameRejected = false;
  let batchLayerRejected = false;
  let readonlyQueryWorked = false;
  try { stateEditor.exec({ type: 'SetXfrm', id: child.id, x: child.src.x + 1 }); } catch {
    transformRejected = true;
  }
  try { stateEditor.exec({ type: 'SetName', id: child.id, name: '不能借窗格改名' }); } catch {
    renameRejected = true;
  }
  try {
    stateEditor.exec(
      { type: 'SetZ', id: child.id, to: 'front' },
      { type: 'SetZ', id: sibling.id, to: 'back' },
    );
  } catch { batchLayerRejected = true; }
  try { readonlyQueryWorked = !!edit.queryBodyProps(stateDoc, child.id); } catch { /* 只读查询不得受锁影响。 */ }
  check('锁定祖先清理失效选区、阻止后代变换且不制造文稿 dirty',
    locked.forward[0]?.path.join('.') === `elements.${stateGroup.id}.meta.locked`
      && lockedGroup?.ownLocked && lockedChild?.locked && !lockedChild.ownLocked
      && stateEditor.selection.kind === 'none' && transformRejected && renameRejected
      && batchLayerRejected && readonlyQueryWorked
      && stateChange?.paneElements.has(stateGroup.id)
      && stateChange.renderElements.size === 0
      && stateChange.dirtyElements.size === 0 && stateChange.dirtySlides.size === 0
      && stateEditor.history.undoCount === 1 && !stateEditor.isDirty());

  stateEditor.undo();
  check('撤销会话锁定恢复原选区但仍保持文稿干净',
    !stateDoc.elements[stateGroup.id].meta.locked
      && stateEditor.selection.kind === 'elements'
      && stateEditor.selection.ids.join(',') === child.id
      && stateEditor.selection.enteredGroup === stateGroup.id
      && !stateEditor.isDirty());

  const hidden = stateEditor.exec({ type: 'SetElementHidden', id: child.id, hidden: true });
  check('临时隐藏使用独立纯数据 Patch、清理选区且不改变有效投影或 dirty',
    hidden.forward[0]?.path.join('.') === `elements.${child.id}.meta.hiddenByUser`
      && edit.querySelectionPane(stateDoc, stateSlide).find((item) => item.id === child.id)?.hidden
      && stateEditor.selection.kind === 'none' && !stateEditor.isDirty()
      && stateEditor.effectiveElement(child.id).name === 'layer-child-a');
  stateEditor.exec({ type: 'SetElementHidden', id: child.id, hidden: false });
  check('显示对象删除自身隐藏声明且重复显示严格 no-op',
    !Object.hasOwn(stateDoc.elements[child.id].meta, 'hiddenByUser')
      && stateEditor.exec({ type: 'SetElementHidden', id: child.id, hidden: false }).forward.length === 0);

  stateEditor.exec({ type: 'SetName', id: child.id, name: '仍需保存的名称' });
  stateEditor.exec({ type: 'SetLocked', id: child.id, locked: true });
  check('内容与会话状态分离：已有名称覆盖脏时锁定不会改变 dirty 结论',
    stateEditor.isDirty() && stateEditor.history.undoCount === 4);
  edit.disposeDoc(stateDoc);

  console.log('\n\x1b[36m▸ 选择窗格恢复与非法输入边界\x1b[0m');
  const recoveryPresentation = await core.parse(bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const recoveryDoc = edit.createDoc(recoveryPresentation, { idPrefix: 'selection-recovery-' });
  const recoveryEditor = new edit.Editor(recoveryDoc);
  const recoveryRecords = Object.values(recoveryDoc.elements);
  const recoveryGroup = recoveryRecords.find((record) => record.src.name === 'layer-group');
  const recoveryChild = recoveryRecords.find((record) => record.src.name === 'layer-child-a');
  const frames = [];
  recoveryEditor.subscribeRecovery((frame) => frames.push(frame));
  recoveryEditor.exec({ type: 'SetName', id: recoveryChild.id, name: '恢复后的对象名' });
  recoveryEditor.exec({ type: 'SetLocked', id: recoveryGroup.id, locked: true });
  recoveryEditor.exec({ type: 'SetElementHidden', id: recoveryChild.id, hidden: true });
  const persistentFrames = JSON.parse(JSON.stringify(frames));
  const restoredPresentation = await core.parse(bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const restoredDoc = edit.createDoc(restoredPresentation, { idPrefix: 'selection-recovery-' });
  const restoredEditor = new edit.Editor(restoredDoc, { recoveryFrames: persistentFrames });
  const restoredItems = edit.querySelectionPane(restoredDoc, restoredDoc.slideOrder[0]);
  const restoredChild = restoredItems.find((item) => item.name === '恢复后的对象名');
  check('名称与会话状态经纯 JSON 崩溃日志确定恢复，dirty 只由内容决定',
    restoredChild?.hidden && restoredChild.locked
      && restoredItems.find((item) => item.id === recoveryGroup.id)?.ownLocked
      && restoredEditor.isDirty() && restoredEditor.history.undoCount === 0
      && persistentFrames.at(-1)?.dirty === true);

  let fillRejected = false;
  let removeRejected = false;
  try {
    restoredEditor.exec({
      type: 'SetFill', id: recoveryChild.id, fill: { type: 'solid', color: '#123456' },
    });
  } catch { fillRejected = true; }
  try { restoredEditor.exec({ type: 'RemoveElement', id: recoveryChild.id }); } catch {
    removeRejected = true;
  }
  check('锁定祖先统一阻止内容格式与结构命令', fillRejected && removeRejected);

  const readonlyRecord = Object.values(restoredDoc.elements).find((record) =>
    record.meta.editable === 'none' || !record.meta.origin);
  const readonlyBefore = JSON.stringify(restoredDoc);
  let readonlyNamePatchRejected = false;
  try {
    edit.applyPatches(restoredDoc, [{
      op: 'set', path: ['elements', readonlyRecord.id, 'ovr', 'name'],
      value: '不能写入的名称', origin: 'malformed',
    }]);
  } catch { readonlyNamePatchRejected = JSON.stringify(restoredDoc) === readonlyBefore; }
  check('公开 Patch 同样在落模前拒绝不可写名称宿主', readonlyNamePatchRejected);

  const malformed = structuredClone(restoredDoc);
  const malformedBefore = JSON.stringify(malformed);
  let malformedPatchRejected = false;
  try {
    edit.applyPatches(malformed, [{
      op: 'insert', path: ['elements', recoveryChild.id, 'ovr', 'name'],
      value: '非法', origin: 'malformed',
    }]);
  } catch {
    malformedPatchRejected = JSON.stringify(malformed) === malformedBefore;
  }
  const invalidNames = ['', '   ', 'x'.repeat(edit.MAX_ELEMENT_NAME_LENGTH + 1), 'bad\u0000name'];
  const invalidNameRejected = invalidNames.every((name) => {
    const before = JSON.stringify(restoredDoc);
    try { restoredEditor.exec({ type: 'SetName', id: recoveryChild.id, name }); } catch {
      return JSON.stringify(restoredDoc) === before;
    }
    return false;
  });
  check('非法名称、命令值和 Patch 操作在落模前原子拒绝',
    malformedPatchRejected && invalidNameRejected);
  edit.disposeDoc(restoredDoc);
  edit.disposeDoc(recoveryDoc);

  console.log('\n\x1b[36m▸ 选择窗格与版式投影同步\x1b[0m');
  const layoutPresentation = await core.parse(load('sample-editor-change-layout.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const layoutDoc = edit.createDoc(layoutPresentation, { idPrefix: 'selection-layout-' });
  const layoutEditor = new edit.Editor(layoutDoc);
  const layoutSlide = layoutDoc.slideOrder[0];
  const targetLayout = layoutDoc.layoutOrder.find((id) => layoutDoc.layouts[id].name === '重点内容');
  const staleInherited = new Set(edit.querySelectionPane(layoutDoc, layoutSlide)
    .filter((item) => layoutDoc.elements[item.id].meta.inherited).map((item) => item.id));
  layoutEditor.exec({ type: 'SetLayout', id: layoutSlide, layoutId: targetLayout });
  const projectedPane = edit.querySelectionPane(layoutDoc, layoutSlide);
  const projectedRoots = projectedPane.filter((item) => item.depth === 0).map((item) => item.id).sort();
  const expectedRoots = layoutDoc.slides[layoutSlide].children
    .filter((id) => !layoutDoc.elements[id].meta.inherited).sort();
  check('换版式后窗格移除旧继承幽灵对象并只暴露带稳定身份的当前交互树',
    projectedRoots.join(',') === expectedRoots.join(',')
      && projectedPane.every((item) => !staleInherited.has(item.id)));
  layoutEditor.undo();
  check('撤销换版式恢复来源交互树',
    edit.querySelectionPane(layoutDoc, layoutSlide).some((item) => staleInherited.has(item.id)));
  edit.disposeDoc(layoutDoc);
}
