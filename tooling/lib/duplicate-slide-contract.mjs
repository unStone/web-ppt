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
