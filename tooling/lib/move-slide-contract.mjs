/** MoveSlide 的公开命令契约；断言只观察 EditDoc、事务结果与订阅事件。 */
export async function runMoveSlideContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ MoveSlide 稳定页身份与历史\x1b[0m');
  const input = load('sample-media.pptx');
  if (!check('找到页面重排固件', !!input)) return;
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'move-slide-' });
  const editor = new edit.Editor(doc);
  const source = [...doc.slideOrder];
  const selected = doc.slides[source[2]].children.find((id) => doc.elements[id].meta.editable !== 'none');
  if (selected) editor.select({ kind: 'elements', ids: [selected], enteredGroup: null });
  const observed = [];
  const unsubscribe = editor.subscribe((change) => observed.push(change));

  const result = editor.exec({ type: 'MoveSlide', id: source[2], at: { after: null } });
  check('公开命令把稳定页身份置首且不伪装页面增删',
    doc.slideOrder.join(',') === [source[2], source[0], source[1], ...source.slice(3)].join(',')
      && result.forward.length === 1 && result.forward[0].path[0] === 'slideOrder'
      && result.createdSlides.size === 0 && result.removedSlides.size === 0
      && result.movedSlides.has(source[2]) && observed.at(-1)?.movedSlides.has(source[2])
      && (!selected || editor.selection.ids?.[0] === selected));

  const movedOrder = [...doc.slideOrder];
  const undo = editor.undo();
  const redo = editor.redo();
  check('撤销重做恢复精确页序、稳定选区并继续报告移动页',
    redo?.movedSlides.has(source[2]) && undo?.movedSlides.has(source[2])
      && doc.slideOrder.join(',') === movedOrder.join(',')
      && (!selected || editor.selection.ids?.[0] === selected));

  const beforeNoopHistory = editor.history.undoCount;
  const beforeNoopEvents = observed.length;
  const noop = editor.exec({ type: 'MoveSlide', id: source[2], at: { after: null } });
  check('页面已经位于目标位置时不产生 patch、历史或订阅事件',
    noop.forward.length === 0 && editor.history.undoCount === beforeNoopHistory
      && observed.length === beforeNoopEvents);

  editor.exec({ type: 'MoveSlide', id: source[2], at: { after: source[0] } });
  check('公开命令可把页面置于稳定锚点后的中间位置',
    doc.slideOrder[1] === source[2] && doc.slideOrder[0] === source[0]);
  editor.exec({ type: 'MoveSlide', id: source[2], at: { after: doc.slideOrder.at(-1) } });
  check('公开命令可把页面置尾', doc.slideOrder.at(-1) === source[2]);

  const batchSource = [...doc.slideOrder];
  const beforeBatchHistory = editor.history.undoCount;
  editor.exec(
    { type: 'MoveSlide', id: batchSource[0], at: { after: batchSource[2] } },
    { type: 'MoveSlide', id: batchSource[1], at: { after: batchSource[0] } },
  );
  check('合法批量按提交顺序求终态并合成一条历史',
    doc.slideOrder.join(',')
      === [batchSource[2], batchSource[0], batchSource[1], ...batchSource.slice(3)].join(',')
      && editor.history.undoCount === beforeBatchHistory + 1);

  const beforeInvalid = {
    order: doc.slideOrder.join(','), selection: JSON.stringify(editor.selection),
    history: editor.history.undoCount,
  };
  const rejected = (fn) => { try { fn(); return false; } catch { return true; } };
  check('未知页、未知锚点、自锚点、畸形 at 与额外字段被原子拒绝',
    rejected(() => editor.exec({ type: 'MoveSlide', id: 'missing', at: { after: null } }))
      && rejected(() => editor.exec({ type: 'MoveSlide', id: source[0], at: { after: 'missing' } }))
      && rejected(() => editor.exec({ type: 'MoveSlide', id: source[0], at: { after: source[0] } }))
      && rejected(() => editor.exec({ type: 'MoveSlide', id: source[0], at: {} }))
      && rejected(() => editor.exec({ type: 'MoveSlide', id: source[0], at: { after: null }, extra: true }))
      && doc.slideOrder.join(',') === beforeInvalid.order
      && JSON.stringify(editor.selection) === beforeInvalid.selection
      && editor.history.undoCount === beforeInvalid.history);

  check('批量命令按提交顺序求终态，后段失败会回滚前段移动', (() => {
    const before = doc.slideOrder.join(',');
    const failed = rejected(() => editor.exec(
      { type: 'MoveSlide', id: source[0], at: { after: source.at(-1) } },
      { type: 'MoveSlide', id: source[1], at: { after: 'missing' } },
    ));
    return failed && doc.slideOrder.join(',') === before;
  })());

  unsubscribe();
  edit.disposeDoc(doc);

  const dynamicInput = load('sample-editor-add-slide.pptx');
  const dynamicPresentation = await core.parse(dynamicInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const dynamicDoc = edit.createDoc(dynamicPresentation, { idPrefix: 'move-slide-dynamic-' });
  const dynamicEditor = new edit.Editor(dynamicDoc);
  const layoutId = dynamicDoc.layoutOrder.find((id) => dynamicDoc.layouts[id].name === '标题和正文');
  const original = dynamicDoc.slideOrder[0];
  const firstAdded = [...dynamicEditor.exec({
    type: 'AddSlide', layoutId, at: { after: original },
  }).createdSlides][0];
  const secondAdded = [...dynamicEditor.exec({
    type: 'AddSlide', layoutId, at: { after: firstAdded },
  }).createdSlides][0];
  const pageNumberText = (slideId) => dynamicEditor.toSlide(slideId).elements
    .find((element) => element.editInfo?.placeholder?.type === 'sldNum')?.text.paragraphs
    .flatMap((paragraph) => paragraph.runs).map((run) => run.text).join('');
  const movedDynamic = dynamicEditor.exec({
    type: 'MoveSlide', id: secondAdded, at: { after: null },
  });
  check('已有页与新增页混排会即时刷新动态页码与相对跳页投影',
    dynamicDoc.slideOrder.join(',') === `${secondAdded},${original},${firstAdded}`
      && pageNumberText(secondAdded) === '第 1 页'
      && pageNumberText(firstAdded) === '第 3 页'
      && movedDynamic.dirtyElements.has(dynamicDoc.slides[secondAdded].dynamicSlideNumbers[0])
      && dynamicEditor.toSlide(original).elements.some((element) =>
        element.name === '现有页下一页链接' && element.link === 'slide:3'));
  check('页面重排后的 EditDoc 仍可 structuredClone', (() => {
    try { return structuredClone(dynamicDoc).slideOrder.join(',') === dynamicDoc.slideOrder.join(','); }
    catch { return false; }
  })());
  edit.disposeDoc(dynamicDoc);
}
