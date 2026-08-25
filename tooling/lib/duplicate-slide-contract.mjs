const rejected = (fn) => { try { fn(); return false; } catch { return true; } };

const descendants = (doc, slideId) => {
  const result = [];
  const visit = (id) => {
    result.push(id);
    for (const child of doc.elements[id].children ?? []) visit(child);
  };
  for (const id of doc.slides[slideId].children) visit(id);
  return result;
};

const remapSlideTreeIds = (patch, suffix) => {
  const remote = structuredClone(patch);
  const sourceSlideId = remote.path[1];
  const slideId = `${sourceSlideId}-${suffix}`;
  const elementIds = new Map(Object.keys(remote.value.records)
    .map((id) => [id, `${id}-${suffix}`]));
  const remap = (id) => elementIds.get(id) ?? id;
  remote.path[1] = slideId;
  remote.value.slide.id = slideId;
  remote.value.slide.children = remote.value.slide.children.map(remap);
  remote.value.slide.dynamicSlideNumbers = remote.value.slide.dynamicSlideNumbers.map(remap);
  remote.value.slide.dynamicSlideLinks = remote.value.slide.dynamicSlideLinks.map(remap);
  remote.value.records = Object.fromEntries(Object.entries(remote.value.records).map(([id, record]) => {
    const mapped = structuredClone(record);
    mapped.id = remap(id);
    mapped.parent = record.parent === sourceSlideId ? slideId : remap(record.parent);
    if (mapped.children) mapped.children = mapped.children.map(remap);
    return [mapped.id, mapped];
  }));
  return remote;
};

/** DuplicateSlide 的公开模型 seam：守住紧邻副本、内容、身份隔离与原子历史。 */
export async function runDuplicateSlideContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ DuplicateSlide 独立身份、投影与历史\x1b[0m');
  const input = load('sample-editor-duplicate-slide.pptx');
  if (!check('找到页面复制基础固件', !!input)) return;
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'duplicate-slide-' });
  const editor = new edit.Editor(doc);
  const sourceId = doc.slideOrder[1];
  const sourceIndex = doc.slideOrder.indexOf(sourceId);
  const sourceTree = descendants(doc, sourceId);
  const sourceElements = new Set(sourceTree);
  const editedSourceElement = doc.slides[sourceId].children[0];
  editor.exec({
    type: 'SetXfrm', id: editedSourceElement, x: doc.elements[editedSourceElement].src.x + 13,
  });
  editor.select({ kind: 'elements', ids: [editedSourceElement], enteredGroup: null });
  const historyBefore = editor.history.undoCount;
  const result = editor.exec({ type: 'DuplicateSlide', id: sourceId });
  const duplicateId = [...result.createdSlides][0];
  const duplicate = doc.slides[duplicateId];
  const duplicateTree = descendants(doc, duplicateId);
  const duplicateProjection = JSON.stringify(editor.toSlide(duplicateId).elements);

  check('公开命令在来源后创建内容等价且身份独立的页面',
    !!duplicateId && doc.slideOrder[sourceIndex + 1] === duplicateId
      && result.createdSlides.size === 1 && !result.removedSlides.size && !result.movedSlides.size
      && duplicate.children.length === doc.slides[sourceId].children.length
      && duplicateTree.length === sourceTree.length
      && duplicateTree.every((id) => !sourceElements.has(id))
      && duplicateProjection.includes('可删除页面 2')
      && duplicateProjection.includes('"text":"3"')
      && duplicateProjection.includes('"link":"slide:4"'));
  check('副本深拷贝当前覆盖、嵌套父链并把全部写回锚点改到新 part',
    doc.elements[duplicate.children[0]].ovr.x === doc.elements[editedSourceElement].ovr.x
      && duplicateTree.some((id) => doc.elements[id].children?.some((child) =>
        !!doc.elements[child].children?.length))
      && duplicateTree.every((id) => doc.elements[id].meta.origin?.part === duplicate.origin.part)
      && duplicateTree.every((id) => {
        const parent = doc.elements[id].parent;
        return parent === duplicateId || duplicateTree.includes(parent);
      }));
  check('公开模型校验拒绝共享 notes 身份或丢失的副本基线', (() => {
    const sharedNotes = structuredClone(doc);
    sharedNotes.slides[duplicateId].creation.duplicateNotesPart
      = sharedNotes.slides[duplicateId].creation.duplicateNotesSourcePart;
    const missingBaseline = structuredClone(doc);
    missingBaseline.slides[duplicateId].creation.duplicateSourcePart
      = 'ppt/slides/slide999.xml';
    return rejected(() => edit.validateEditDoc(sharedNotes))
      && rejected(() => edit.validateEditDoc(missingBaseline));
  })());

  const duplicateElement = duplicate.children[0];
  const duplicateX = doc.elements[duplicateElement].ovr.x;
  editor.exec({
    type: 'SetXfrm', id: editedSourceElement, x: doc.elements[editedSourceElement].src.x + 29,
  });
  check('复制后的来源编辑不会改变副本',
    doc.elements[duplicateElement].ovr.x === duplicateX
      && doc.elements[editedSourceElement].ovr.x !== duplicateX);
  editor.undo();

  const undo = editor.undo();
  const absentAfterUndo = !doc.slides[duplicateId];
  const undoSelection = JSON.stringify(editor.selection);
  const redo = editor.redo();
  check('一次撤销重做恢复同一批页面与元素身份及来源选区',
    undo?.removedSlides.has(duplicateId) && absentAfterUndo
      && undoSelection === JSON.stringify({
        kind: 'elements', ids: [editedSourceElement], enteredGroup: null,
      })
      && redo?.createdSlides.has(duplicateId)
      && descendants(doc, duplicateId).join(',') === duplicateTree.join(',')
      && editor.history.undoCount === historyBefore + 1);

  const conflictPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const conflictDoc = edit.createDoc(conflictPresentation, { idPrefix: 'duplicate-conflict-' });
  const conflictEditor = new edit.Editor(conflictDoc);
  const conflictSourceId = conflictDoc.slideOrder[1];
  const pending = conflictEditor.exec({ type: 'DuplicateSlide', id: conflictSourceId });
  const pendingId = [...pending.createdSlides][0];
  conflictEditor.undo();
  const redoEntry = conflictEditor.history.redoEntries[0];
  const remote = remapSlideTreeIds(redoEntry.forward[0], 'remote');
  edit.applyPatches(conflictDoc, [remote]);
  const remoteId = remote.path[1];
  const beforeConflictingRedo = {
    order: conflictDoc.slideOrder.join(','),
    slides: Object.keys(conflictDoc.slides).sort().join(','),
    elements: Object.keys(conflictDoc.elements).sort().join(','),
    selection: JSON.stringify(conflictEditor.selection),
    undo: conflictEditor.history.undoCount,
    redo: conflictEditor.history.redoCount,
  };
  let conflictingRedoRejected = false;
  try { conflictEditor.redo(); } catch { conflictingRedoRejected = true; }
  check('远端页面占用待重做 OPC 身份时，重做原子拒绝且历史仍可恢复',
    conflictingRedoRejected
      && !conflictDoc.slides[pendingId] && !!conflictDoc.slides[remoteId]
      && conflictDoc.slideOrder.join(',') === beforeConflictingRedo.order
      && Object.keys(conflictDoc.slides).sort().join(',') === beforeConflictingRedo.slides
      && Object.keys(conflictDoc.elements).sort().join(',') === beforeConflictingRedo.elements
      && JSON.stringify(conflictEditor.selection) === beforeConflictingRedo.selection
      && conflictEditor.history.undoCount === beforeConflictingRedo.undo
      && conflictEditor.history.redoCount === beforeConflictingRedo.redo
      && (() => { try { edit.validateEditDoc(conflictDoc); return true; } catch { return false; } })());
  if (conflictingRedoRejected) {
    edit.applyPatches(conflictDoc, [{ ...remote, op: 'remove' }]);
    const recovered = conflictEditor.redo();
    check('冲突远端页移除后，原本的重做记录仍恢复同一页面身份',
      recovered?.createdSlides.has(pendingId) && !!conflictDoc.slides[pendingId]
        && (() => { try { edit.validateEditDoc(conflictDoc); return true; } catch { return false; } })());
  }
  edit.disposeDoc(conflictDoc);

  editor.undo();
  const batchHistory = editor.history.undoCount;
  const batch = editor.exec(
    { type: 'DuplicateSlide', id: sourceId },
    { type: 'DuplicateSlide', id: sourceId },
  );
  const batchIds = [...batch.createdSlides];
  const batchUndo = editor.undo();
  check('合法批量复制产生两份独立页面但只形成一条可逆历史',
    batchIds.length === 2 && new Set(batchIds).size === 2
      && batchIds.every((id) => batchUndo?.removedSlides.has(id) && !doc.slides[id])
      && editor.history.undoCount === batchHistory);
  const atomicBefore = {
    order: doc.slideOrder.join(','), identity: JSON.stringify(doc.identity),
    selection: JSON.stringify(editor.selection), history: editor.history.undoCount,
  };
  check('额外字段、未知页、只读和非法批量在身份分配前原子拒绝',
    rejected(() => editor.exec({ type: 'DuplicateSlide', id: sourceId, extra: true }))
      && rejected(() => editor.exec({ type: 'DuplicateSlide', id: 'missing' }))
      && (() => {
        doc.meta.readonly = true;
        const ok = rejected(() => editor.exec({ type: 'DuplicateSlide', id: sourceId }));
        doc.meta.readonly = false;
        return ok;
      })()
      && rejected(() => editor.exec(
        { type: 'DuplicateSlide', id: sourceId },
        { type: 'DuplicateSlide', id: 'missing' },
      ))
      && doc.slideOrder.join(',') === atomicBefore.order
      && JSON.stringify(doc.identity) === atomicBefore.identity
      && JSON.stringify(editor.selection) === atomicBefore.selection
      && editor.history.undoCount === atomicBefore.history);

  const add = editor.exec({
    type: 'AddSlide', layoutId: doc.layoutOrder[0], at: { after: sourceId },
  });
  const addedId = [...add.createdSlides][0];
  const duplicateAdded = editor.exec({ type: 'DuplicateSlide', id: addedId });
  const firstCopy = [...duplicateAdded.createdSlides][0];
  const duplicateChain = editor.exec({ type: 'DuplicateSlide', id: firstCopy });
  const secondCopy = [...duplicateChain.createdSlides][0];
  check('未保存 AddSlide 页与未保存副本都能继续复制且 OPC 身份互不复用',
    doc.slideOrder.indexOf(firstCopy) === doc.slideOrder.indexOf(addedId) + 1
      && doc.slideOrder.indexOf(secondCopy) === doc.slideOrder.indexOf(firstCopy) + 1
      && new Set([addedId, firstCopy, secondCopy]).size === 3
      && new Set([addedId, firstCopy, secondCopy]
        .map((id) => doc.slides[id].origin.part)).size === 3
      && new Set([firstCopy, secondCopy]
        .map((id) => doc.slides[id].creation.presentationSlideId)).size === 2);
  check('页面复制后的 EditDoc 与命令仍可结构化克隆', (() => {
    try {
      const cloned = structuredClone({ doc, command: { type: 'DuplicateSlide', id: sourceId } });
      return cloned.doc.slideOrder.includes(secondCopy);
    } catch { return false; }
  })());

  edit.disposeDoc(doc);
}
