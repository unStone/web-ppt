const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const rejected = (fn) => { try { fn(); return false; } catch { return true; } };

/** 演讲者备注只通过公开命令、查询、投影和订阅分区观察。 */
export async function runSlideNotesContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 演讲者备注纯文本编辑\x1b[0m');
  if (!check('发布入口公开备注查询', typeof edit.querySlideNotes === 'function')) return;
  const notesPresentation = await core.parse(load('sample-editor-notes.pptx'), {
    lazy: false, assets: 'defer',
  });
  check('预览解析只读取 body 占位符并保留正文段落边界',
    notesPresentation.slides[0].notes === '来源第一段\n来源第二段'
      && !notesPresentation.slides[0].notes.includes('页脚不得进入'));
  notesPresentation.dispose?.();
  const presentation = await core.parse(load('sample-editor-remove-slide.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'slide-notes-' });
  const editor = new edit.Editor(doc);
  const [first, second] = doc.slideOrder;
  const source = edit.querySlideNotes(doc, [first, second]);
  check('多页查询区分有效值与来源混合态',
    source.value === '页面 1 的独立备注' && source.source === '页面 1 的独立备注'
      && source.mixed && source.sourceMixed && !source.direct);

  let observed;
  const unsubscribe = editor.subscribe((change) => { observed = change; });
  const result = editor.exec({ type: 'SetNotes', id: first, text: '第一段\n第二段' });
  const changed = edit.querySlideNotes(doc, [first]);
  check('SetNotes 只产生备注覆盖与备注订阅，不触发画布投影失效',
    result.forward.length === 1
      && result.forward[0].path.join('/') === `slides/${first}/ovr/notes`
      && result.notesSlides.has(first) && observed?.notesSlides.has(first)
      && result.dirtySlides.size === 0 && result.dirtyElements.size === 0
      && result.renderSlides.size === 0
      && changed.value === '第一段\n第二段' && changed.source === '页面 1 的独立备注'
      && changed.direct && editor.toSlide(first).notes === '第一段\n第二段'
      && own(doc.slides[first].ovr, 'notes')
      && editor.history.undoEntries.at(-1)?.affectedSlides[0] === first);

  const undo = editor.undo();
  check('撤销恢复来源备注并保留稳定页面身份',
    undo?.notesSlides.has(first) && editor.toSlide(first).notes === '页面 1 的独立备注'
      && !edit.querySlideNotes(doc, [first]).direct && doc.slideOrder[0] === first);

  const batchHistory = editor.history.undoCount;
  const batch = editor.exec(
    { type: 'SetNotes', id: first, text: '' },
    { type: 'SetNotes', id: second, text: '第二页批量备注' },
  );
  check('空字符串是直接清空，双页批量仍只有一条历史且不重绘画布',
    edit.querySlideNotes(doc, [first]).value === ''
      && edit.querySlideNotes(doc, [first]).direct
      && batch.notesSlides.has(first) && batch.notesSlides.has(second)
      && batch.dirtySlides.size === 0 && batch.renderSlides.size === 0
      && editor.history.undoCount === batchHistory + 1
      && editor.history.undoEntries.at(-1)?.affectedSlides.length === 2);
  editor.undo();

  const sharedPresentation = await core.parse(load('sample-editor-remove-slide-shared-notes.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const sharedDoc = edit.createDoc(sharedPresentation, { idPrefix: 'slide-notes-shared-' });
  const sharedEditor = new edit.Editor(sharedDoc);
  const sharedId = sharedDoc.slideOrder[2];
  const siblingId = sharedDoc.slideOrder[1];
  const sourceTarget = sharedDoc.slides[sharedId].notes.targetPart;
  const sharedResult = sharedEditor.exec({ type: 'SetNotes', id: sharedId, text: '只属于第三页' });
  check('共享 notes 身份在命令期先分叉，编辑不会污染兄弟页面',
    sourceTarget === sharedDoc.slides[siblingId].notes.targetPart
      && sharedDoc.slides[sharedId].notes.sourcePart === sourceTarget
      && sharedDoc.slides[sharedId].notes.targetPart === 'ppt/notesSlides/notesSlide5.xml'
      && sharedDoc.slides[sharedId].notes.targetPart !== sharedDoc.slides[siblingId].notes.targetPart
      && sharedResult.forward.length === 2
      && sharedEditor.toSlide(siblingId).notes === '页面 2 的独立备注');
  check('模型校验拒绝缺失来源、空关系和无绑定的备注覆盖', (() => {
    const missingSource = structuredClone(sharedDoc);
    missingSource.slides[sharedId].notes.sourcePart = 'ppt/notesSlides/missing.xml';
    const emptyRelationship = structuredClone(sharedDoc);
    emptyRelationship.slides[sharedId].notes.relationshipId = '';
    const missingBinding = structuredClone(sharedDoc);
    delete missingBinding.slides[sharedId].notes;
    return rejected(() => edit.validateEditDoc(missingSource))
      && rejected(() => edit.validateEditDoc(emptyRelationship))
      && rejected(() => edit.validateEditDoc(missingBinding));
  })());
  sharedEditor.undo();
  check('撤销共享备注编辑恢复原 notes 身份',
    sharedDoc.slides[sharedId].notes.targetPart === sourceTarget
      && !edit.querySlideNotes(sharedDoc, [sharedId]).direct);
  edit.disposeDoc(sharedDoc);

  const addPresentation = await core.parse(load('sample-editor-add-slide.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const addDoc = edit.createDoc(addPresentation, { idPrefix: 'slide-notes-new-' });
  const addEditor = new edit.Editor(addDoc);
  const add = addEditor.exec({
    type: 'AddSlide', layoutId: addDoc.layoutOrder[0], at: { after: addDoc.slideOrder[0] },
  });
  const addedId = [...add.createdSlides][0];
  const addedNotes = addEditor.exec({ type: 'SetNotes', id: addedId, text: '新页备注' });
  check('无 notes 的会话新页首次编辑才分配确定性 part 与关系身份',
    addedNotes.forward.length === 2
      && addDoc.slides[addedId].notes.targetPart === 'ppt/notesSlides/notesSlide1.xml'
      && addDoc.slides[addedId].notes.sourcePart === undefined
      && addDoc.slides[addedId].notes.relationshipId === 'rId2');
  addEditor.undo();
  check('撤销新页首次备注不会留下孤立身份', !addDoc.slides[addedId].notes);
  edit.disposeDoc(addDoc);

  const beforeAtomic = JSON.stringify(doc);
  const historyBeforeAtomic = editor.history.undoCount;
  check('非法值、额外字段与同页备注后删除都在修改模型前原子拒绝',
    rejected(() => editor.exec({ type: 'SetNotes', id: 'missing', text: 'x' }))
      && rejected(() => editor.exec({ type: 'SetNotes', id: first, text: 1 }))
      && rejected(() => editor.exec({ type: 'SetNotes', id: first, text: 'x', extra: true }))
      && rejected(() => editor.exec(
        { type: 'SetNotes', id: first, text: '先改后删' },
        { type: 'RemoveSlide', id: first },
      ))
      && JSON.stringify(doc) === beforeAtomic && editor.history.undoCount === historyBeforeAtomic);
  unsubscribe();
  edit.disposeDoc(doc);
}
