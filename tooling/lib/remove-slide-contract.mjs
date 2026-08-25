const rejected = (fn) => { try { fn(); return false; } catch { return true; } };

const textOf = (slide) => JSON.stringify(slide.elements);

/** RemoveSlide 的公开模型 seam：命令、事务结果、订阅、投影与历史。 */
export async function runRemoveSlideContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ RemoveSlide 稳定身份、fallback 与历史\x1b[0m');
  const input = load('sample-editor-remove-slide.pptx');
  if (!check('找到页面删除固件', !!input)) return;
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'remove-slide-' });
  const editor = new edit.Editor(doc);
  const source = [...doc.slideOrder];
  const selected = doc.slides[source[1]].children[0];
  editor.exec({
    type: 'SetXfrm', id: selected, x: doc.elements[selected].src.x + 9,
  });
  const overrideBeforeRemoval = JSON.stringify(doc.elements[selected].ovr);
  editor.select({ kind: 'elements', ids: [selected], enteredGroup: null });
  const events = [];
  const unsubscribe = editor.subscribe((change) => events.push(change));

  const removed = editor.exec({ type: 'RemoveSlide', id: source[1] });
  check('公开命令用一个页面树 patch 删除中间页并公开最近后继',
    doc.slideOrder.join(',') === [source[0], source[2], source[3]].join(',')
      && removed.forward.length === 1 && removed.forward[0].op === 'remove'
      && removed.forward[0].path.join(',') === `slides,${source[1]}`
      && removed.removedSlides.has(source[1]) && !removed.createdSlides.size && !removed.movedSlides.size
      && removed.removedSlideFallbacks.get(source[1]) === source[2]
      && events.at(-1)?.removedSlideFallbacks.get(source[1]) === source[2]
      && editor.selection.kind === 'none' && !doc.slides[source[1]] && !doc.elements[selected]);
  check('删除页面只增量刷新受页序影响的动态字段',
    textOf(editor.toSlide(source[2])).includes('可删除页面 3')
      && textOf(editor.toSlide(source[2])).includes('"text":"2"')
      && textOf(editor.toSlide(source[2])).includes('"link":"slide:3"')
      && removed.dirtyElements.has(doc.slides[source[2]].dynamicSlideNumbers[0])
      && removed.dirtyElements.has(doc.slides[source[2]].dynamicSlideLinks[0])
      && !removed.dirtyElements.has(doc.slides[source[0]].dynamicSlideNumbers[0]));

  const undo = editor.undo();
  const undoSlide = doc.slides[source[1]];
  const undoElement = doc.elements[selected];
  const undoSelection = JSON.stringify(editor.selection);
  const redo = editor.redo();
  check('撤销重做恢复同一页树、位置、选区与 fallback',
    undo?.createdSlides.has(source[1]) && undoSlide?.id === source[1]
      && JSON.stringify(undoElement?.ovr) === overrideBeforeRemoval
      && undoSelection === JSON.stringify({ kind: 'elements', ids: [selected], enteredGroup: null })
      && redo?.removedSlides.has(source[1])
      && redo?.removedSlideFallbacks.get(source[1]) === source[2]
      && doc.slideOrder.join(',') === [source[0], source[2], source[3]].join(','));
  editor.undo();

  const batchHistoryBefore = editor.history.undoCount;
  const batch = editor.exec(
    { type: 'RemoveSlide', id: source[1] },
    { type: 'RemoveSlide', id: source[2] },
  );
  check('合法批量删除按最终存活邻居计算 fallback 并只形成一条历史',
    doc.slideOrder.join(',') === [source[0], source[3]].join(',')
      && batch.removedSlideFallbacks.get(source[1]) === source[3]
      && batch.removedSlideFallbacks.get(source[2]) === source[3]
      && editor.history.undoCount === batchHistoryBefore + 1);
  const batchUndo = editor.undo();
  check('批量删除一次撤销即恢复两页、原位置和原历史深度',
    batchUndo?.createdSlides.has(source[1]) && batchUndo?.createdSlides.has(source[2])
      && doc.slideOrder.join(',') === source.join(',')
      && editor.history.undoCount === batchHistoryBefore);

  const first = editor.exec({ type: 'RemoveSlide', id: source[0] });
  check('删除首页优先回退到原后继',
    first.removedSlideFallbacks.get(source[0]) === source[1]
      && doc.slideOrder[0] === source[1]);
  editor.undo();
  const tail = editor.exec({ type: 'RemoveSlide', id: source[3] });
  check('删除末页在没有后继时回退到原前驱',
    tail.removedSlideFallbacks.get(source[3]) === source[2]
      && doc.slideOrder.at(-1) === source[2]);
  editor.undo();

  const layoutId = doc.layoutOrder[0];
  const added = editor.exec({ type: 'AddSlide', layoutId, at: { after: source[0] } });
  const addedId = [...added.createdSlides][0];
  const removedAdded = editor.exec({ type: 'RemoveSlide', id: addedId });
  check('未存盘新增页可由同一公开删除命令回收且历史保持稳定身份',
    !!addedId && removedAdded.removedSlides.has(addedId)
      && doc.slideOrder.join(',') === source.join(',') && !doc.slides[addedId]);
  editor.undo();
  const restoredAdded = doc.slides[addedId];
  editor.redo();
  check('新增页删除的撤销重做不重新分配页面或 OPC 身份',
    restoredAdded?.id === addedId && restoredAdded?.origin?.part === removedAdded.forward[0].value.slide.origin?.part
      && !doc.slides[addedId]);
  editor.undo();
  editor.undo();

  const before = {
    order: doc.slideOrder.join(','), selection: JSON.stringify(editor.selection),
    history: editor.history.undoCount, identity: JSON.stringify(doc.identity),
  };
  check('未知页、额外字段、只读和删除唯一页被原子拒绝',
    rejected(() => editor.exec({ type: 'RemoveSlide', id: 'missing' }))
      && rejected(() => editor.exec({ type: 'RemoveSlide', id: source[0], extra: true }))
      && (() => { doc.meta.readonly = true; const ok = rejected(() => editor.exec({ type: 'RemoveSlide', id: source[0] })); doc.meta.readonly = false; return ok; })()
      && rejected(() => editor.exec(...source.map((id) => ({ type: 'RemoveSlide', id }))))
      && doc.slideOrder.join(',') === before.order
      && JSON.stringify(editor.selection) === before.selection
      && JSON.stringify(doc.identity) === before.identity
      && editor.history.undoCount === before.history);
  editor.exec({ type: 'RemoveSlide', id: source[0] });
  check('页面删除后的 EditDoc 与命令仍可结构化克隆', (() => {
    try {
      const cloned = structuredClone({ doc, command: { type: 'RemoveSlide', id: source[1] } });
      return cloned.doc.slideOrder.length === 3 && !cloned.doc.slides[source[0]];
    }
    catch { return false; }
  })());
  editor.undo();

  unsubscribe();
  edit.disposeDoc(doc);
}
