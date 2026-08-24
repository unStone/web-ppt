import { isDeepStrictEqual } from 'node:util';

const jsonValue = (value) => JSON.parse(JSON.stringify(value));

/** 删除契约只经过公开 Editor、EditDoc 投影与双向历史，不观察内部删除 helper。 */
export async function runElementDeleteContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 元素删除与占位符清空\x1b[0m');
  const bytes = load('sample-editor-delete.pptx');
  if (!check('找到确定性删除固件', !!bytes)) return;
  const pres = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false, assets: 'defer' });
  const doc = edit.createDoc(pres, { idPrefix: 'delete-command-' });
  const editor = new edit.Editor(doc);
  const target = Object.values(doc.elements).find((record) => record.src.name === 'delete-shape');
  const peer = Object.values(doc.elements).find((record) => record.src.name === 'delete-peer');
  if (!check('删除固件暴露普通目标与同页未触碰兄弟', !!target && !!peer)) return;
  const slideId = edit.slideOfElement(doc, target.id);
  const originalChildren = [...doc.slides[slideId].children];
  const originalIndex = originalChildren.indexOf(target.id);
  const originalRecord = structuredClone(target);
  const peerProjection = editor.effectiveElement(peer.id);
  editor.select({ kind: 'elements', ids: [target.id], enteredGroup: null });

  const removed = editor.exec({ type: 'RemoveElement', id: target.id });
  check('RemoveElement 原子移除记录与父级顺序并清理悬空选区',
    !doc.elements[target.id] && !doc.slides[slideId].children.includes(target.id)
      && editor.selection.kind === 'none'
      && editor.toSlide(slideId).elements.every((element) => element.name !== target.src.name)
      && removed.dirtySlides.has(slideId) && removed.touchedElements === undefined
      && editor.history.undoCount === 1 && editor.history.redoCount === 0
      && editor.isDirty() && editor.effectiveElement(peer.id) === peerProjection);
  removed.inverse[0].value.records[target.id].src.name = '外部篡改不应进入历史';
  const undo = editor.undo();
  check('撤销删除在原位置恢复完整记录、选区与干净状态',
    !!undo && JSON.stringify(doc.elements[target.id]) === JSON.stringify(originalRecord)
      && doc.slides[slideId].children[originalIndex] === target.id
      && editor.selection.kind === 'elements' && editor.selection.ids.join(',') === target.id
      && editor.history.undoCount === 0 && editor.history.redoCount === 1 && !editor.isDirty());
  const redo = editor.redo();
  check('重做再次删除同一元素且双向 patch 可 JSON 序列化',
    !!redo && !doc.elements[target.id] && !doc.slides[slideId].children.includes(target.id)
      && editor.selection.kind === 'none' && editor.history.undoCount === 1
      && editor.history.redoCount === 0 && JSON.stringify(editor.history.undoEntries).includes('remove'));
  edit.disposeDoc(doc);

  const placeholderPres = await core.parse(bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const placeholderDoc = edit.createDoc(placeholderPres, { idPrefix: 'delete-placeholder-' });
  const placeholderEditor = new edit.Editor(placeholderDoc);
  const filled = Object.values(placeholderDoc.elements)
    .find((record) => record.src.name === 'delete-placeholder-filled');
  const empty = Object.values(placeholderDoc.elements)
    .find((record) => record.src.name === 'delete-placeholder-empty');
  if (!check('固件区分有内容与空占位符', !!filled?.meta.ph && !!filled.src.text
    && !!empty?.meta.ph && empty.src.text === null)) return;
  placeholderEditor.select({ kind: 'elements', ids: [filled.id], enteredGroup: null });
  placeholderEditor.exec({ type: 'RemoveElement', id: filled.id });
  check('有内容占位符第一次删除只清空文字并保留框、身份与选区',
    placeholderDoc.elements[filled.id] === filled && placeholderDoc.removedElements[filled.id] === undefined
      && placeholderEditor.effectiveElement(filled.id).text === null
      && placeholderEditor.selection.kind === 'elements'
      && placeholderEditor.selection.ids.join(',') === filled.id
      && placeholderEditor.history.undoCount === 1);
  placeholderEditor.exec({ type: 'RemoveElement', id: filled.id });
  check('已清空占位符第二次删除才移除节点并清空选区',
    !placeholderDoc.elements[filled.id] && !!placeholderDoc.removedElements[filled.id]
      && placeholderEditor.selection.kind === 'none' && placeholderEditor.history.undoCount === 2);
  placeholderEditor.undo();
  placeholderEditor.undo();
  const restoredFilled = placeholderDoc.elements[filled.id];
  check('连续撤销依次恢复空框和原始占位符内容',
    !!restoredFilled && placeholderEditor.effectiveElement(filled.id).text !== null
      && !Object.hasOwn(restoredFilled.ovr, 'text') && placeholderEditor.selection.kind === 'elements'
      && placeholderEditor.history.undoCount === 0 && placeholderEditor.history.redoCount === 2
      && !placeholderEditor.isDirty());
  placeholderEditor.select({ kind: 'elements', ids: [empty.id], enteredGroup: null });
  placeholderEditor.exec({ type: 'RemoveElement', id: empty.id });
  check('源文件中已经为空的占位符第一次删除即移除节点',
    !placeholderDoc.elements[empty.id] && !!placeholderDoc.removedElements[empty.id]);
  edit.disposeDoc(placeholderDoc);

  const guardPres = await core.parse(bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const guardDoc = edit.createDoc(guardPres, { idPrefix: 'delete-guard-' });
  const guardEditor = new edit.Editor(guardDoc);
  const guardShape = Object.values(guardDoc.elements)
    .find((record) => record.src.name === 'delete-shape');
  const guardPeer = Object.values(guardDoc.elements)
    .find((record) => record.src.name === 'delete-peer');
  const guardChildren = [...guardDoc.slides[edit.slideOfElement(guardDoc, guardShape.id)].children];
  guardPeer.meta.locked = true;
  let rolledBack = false;
  try {
    guardEditor.transaction((transaction) => {
      transaction.exec({ type: 'RemoveElement', id: guardShape.id });
      transaction.exec({ type: 'RemoveElement', id: guardPeer.id });
    }, '后续命令失败');
  } catch {
    rolledBack = !!guardDoc.elements[guardShape.id] && !!guardDoc.elements[guardPeer.id]
      && guardDoc.slides[edit.slideOfElement(guardDoc, guardShape.id)].children.join(',')
        === guardChildren.join(',')
      && guardEditor.history.undoCount === 0 && !guardEditor.isDirty();
  }
  guardPeer.meta.locked = false;
  const restoredGuardShape = guardDoc.elements[guardShape.id];
  restoredGuardShape.meta.editable = 'none';
  let noneRejected = false;
  try { guardEditor.exec({ type: 'RemoveElement', id: restoredGuardShape.id }); } catch { noneRejected = true; }
  restoredGuardShape.meta.editable = 'full';
  guardDoc.meta.readonly = true;
  let readonlyRejected = false;
  try { guardEditor.exec({ type: 'RemoveElement', id: restoredGuardShape.id }); } catch { readonlyRejected = true; }
  check('删除事务失败整体回滚，readonly、locked 与不可编辑边界均不产生历史',
    rolledBack && noneRejected && readonlyRejected && !!guardDoc.elements[guardShape.id]
      && guardEditor.history.undoCount === 0 && !guardEditor.isDirty());
  edit.disposeDoc(guardDoc);

  const dependencyPres = await core.parse(bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const dependencyDoc = edit.createDoc(dependencyPres, { idPrefix: 'delete-dependency-' });
  const dependencyEditor = new edit.Editor(dependencyDoc);
  const dependencyGroup = Object.values(dependencyDoc.elements)
    .find((record) => record.src.name === 'delete-group');
  const dependencyChild = Object.values(dependencyDoc.elements)
    .find((record) => record.src.name === 'delete-group-child-a');
  const dependencyBefore = jsonValue(dependencyDoc);
  let dependencyRejected = false;
  try {
    dependencyEditor.transaction((transaction) => {
      transaction.exec({ type: 'SetXfrm', id: dependencyChild.id, x: dependencyChild.src.x + 1 });
      transaction.exec({ type: 'RemoveElement', id: dependencyGroup.id });
    }, '修改后删除同一树');
  } catch {
    dependencyRejected = isDeepStrictEqual(jsonValue(dependencyDoc), dependencyBefore)
      && dependencyEditor.history.undoCount === 0 && !dependencyEditor.isDirty();
  }
  check('会产生顺序依赖逆 patch 的修改后删除事务在落模前拒绝', dependencyRejected);
  edit.disposeDoc(dependencyDoc);

  const replayPres = await core.parse(bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const replayDoc = edit.createDoc(replayPres, { idPrefix: 'delete-replay-' });
  const initial = structuredClone(replayDoc);
  const replayEditor = new edit.Editor(replayDoc);
  const replayByName = (name) => Object.values(replayDoc.elements)
    .find((record) => record.src.name === name);
  const replayShape = replayByName('delete-shape');
  const replayGroup = replayByName('delete-group');
  const replayFrame = replayByName('delete-frame');
  replayEditor.transaction((transaction) => {
    for (const id of [replayShape.id, replayGroup.id, replayFrame.id]) {
      transaction.exec({ type: 'RemoveElement', id });
    }
  }, '乱序删除根');
  const final = structuredClone(replayDoc);
  const entry = JSON.parse(JSON.stringify(replayEditor.history.undoEntries[0]));
  const replay = structuredClone(initial);
  let roundtrip = false;
  try {
    edit.applyPatches(replay, entry.forward);
    const forwardMatches = isDeepStrictEqual(jsonValue(replay), jsonValue(final));
    edit.applyPatches(replay, entry.inverse);
    const inverseMatches = isDeepStrictEqual(jsonValue(replay), jsonValue(initial));
    roundtrip = forwardMatches && inverseMatches;
  } catch { /* 合法历史回放不应进入异常分支。 */ }
  check('乱序多根删除的 JSON 正逆 patch 按稳定 z 序完整回放', roundtrip);
  const overlapping = structuredClone(initial);
  let overlapRejected = false;
  try {
    edit.applyPatches(overlapping, [entry.forward[1], entry.forward[1]]);
  } catch {
    overlapRejected = isDeepStrictEqual(jsonValue(overlapping), jsonValue(initial));
  }
  check('同批重叠结构 patch 在修改模型前整体拒绝', overlapRejected);
  edit.disposeDoc(replayDoc);
}
