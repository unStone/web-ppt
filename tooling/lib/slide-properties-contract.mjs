const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const rejected = (fn) => { try { fn(); return false; } catch { return true; } };

/** 页面属性公开 seam：稳定页身份、来源/有效值、历史和渲染失效必须保持同一语义。 */
export async function runSlidePropertiesContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 页面矢量背景与隐藏状态\x1b[0m');
  if (!check('发布入口公开页面背景与隐藏查询',
    typeof edit.querySlideBackground === 'function'
      && typeof edit.querySlideHidden === 'function')) return;
  const presentation = await core.parse(load('sample-editor-slide-properties.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'slide-properties-' });
  const editor = new edit.Editor(doc);
  const [inheritedId, solidId, hiddenId, , , themeRefId] = doc.slideOrder;
  const inheritedSource = structuredClone(doc.slides[inheritedId].src.background);
  const sourceState = edit.querySlideBackground(doc, [inheritedId, solidId]);
  const hiddenSource = edit.querySlideHidden(doc, [inheritedId, hiddenId]);
  check('多页查询区分有效 mixed、来源 mixed 与直接覆盖',
    sourceState.mixed && sourceState.sourceMixed && !sourceState.direct
      && hiddenSource.value === false && hiddenSource.mixed
      && hiddenSource.source === false && hiddenSource.sourceMixed && !hiddenSource.direct);
  const themeRef = edit.querySlideBackground(doc, [themeRefId]);
  const explicitVisibleSource = edit.querySlideHidden(doc, [themeRefId]);
  check('主题色 bgRef 与 show=1 都解析为可编辑来源值',
    themeRef.value?.type === 'solid' && themeRef.value.color === 'rgb(112,173,71)'
      && !themeRef.direct && explicitVisibleSource.value === false
      && explicitVisibleSource.source === false && !explicitVisibleSource.direct);

  let lastChange;
  const unsubscribe = editor.subscribe((change) => { lastChange = change; });
  const backgroundResult = editor.exec({
    type: 'SetBackground', id: inheritedId,
    fill: { type: 'solid', color: '#334155' },
  });
  const background = edit.querySlideBackground(doc, [inheritedId]);
  check('SetBackground 只失效目标页并明确请求整页渲染',
    backgroundResult.dirtySlides.size === 1 && backgroundResult.dirtySlides.has(inheritedId)
      && backgroundResult.dirtyElements.size === 0
      && lastChange?.renderSlides.has(inheritedId)
      && background.value?.type === 'solid' && background.value.color === 'rgb(51,65,85)'
      && JSON.stringify(background.source) === JSON.stringify(inheritedSource)
      && background.direct && own(doc.slides[inheritedId].ovr, 'background'));

  const hiddenResult = editor.exec({ type: 'SetHidden', id: hiddenId, v: false });
  const visible = edit.querySlideHidden(doc, [hiddenId]);
  check('来源隐藏页可显式改回可见且不触发无意义 SVG 重建',
    hiddenResult.dirtySlides.has(hiddenId) && visible.value === false && visible.source === true
      && visible.direct && own(doc.slides[hiddenId].ovr, 'hidden')
      && lastChange?.renderSlides.size === 0);

  const historyBefore = editor.history.undoCount;
  editor.transaction((transaction) => {
    transaction.exec({ type: 'SetHidden', id: inheritedId, v: true });
    transaction.exec({ type: 'SetHidden', id: solidId, v: true });
  }, '隐藏两页');
  const undo = editor.undo();
  check('多页属性事务只形成一个可逆历史项',
    editor.history.undoCount === historyBefore
      && undo?.dirtySlides.has(inheritedId) && undo?.dirtySlides.has(solidId)
      && edit.querySlideHidden(doc, [inheritedId, solidId]).value === false);

  editor.exec({ type: 'SetBackground', id: inheritedId, fill: { type: 'none' } });
  const none = edit.querySlideBackground(doc, [inheritedId]);
  editor.exec({ type: 'SetBackground', id: inheritedId, fill: null });
  editor.exec({ type: 'SetHidden', id: hiddenId, v: null });
  check('显式无背景与恢复来源不同，null 同时恢复来源隐藏状态',
    none.value?.type === 'none' && none.direct
      && !own(doc.slides[inheritedId].ovr, 'background')
      && !own(doc.slides[hiddenId].ovr, 'hidden')
      && JSON.stringify(edit.toSlide(doc, inheritedId).background) === JSON.stringify(inheritedSource)
      && edit.toSlide(doc, hiddenId).hidden === true);

  const sameBackground = editor.exec({
    type: 'SetBackground', id: inheritedId, fill: inheritedSource,
  });
  const sameVisible = editor.exec({ type: 'SetHidden', id: solidId, v: false });
  check('与来源相同的非 null 值仍形成直接覆盖',
    sameBackground.forward.length === 1 && sameVisible.forward.length === 1
      && edit.querySlideBackground(doc, [inheritedId]).direct
      && edit.querySlideHidden(doc, [solidId]).direct);
  editor.exec({ type: 'SetBackground', id: inheritedId, fill: null });
  editor.exec({ type: 'SetHidden', id: solidId, v: null });

  const atomicBefore = JSON.stringify(doc);
  const historyAtomic = editor.history.undoCount;
  check('非法填充、非法布尔、缺页、额外字段与批量失败都原子拒绝',
    rejected(() => editor.exec({ type: 'SetBackground', id: inheritedId, fill: { type: 'image', src: 'data:' } }))
      && rejected(() => editor.exec({ type: 'SetBackground', id: inheritedId, fill: { type: 'solid', color: 'red' } }))
      && rejected(() => editor.exec({ type: 'SetHidden', id: hiddenId, v: 1 }))
      && rejected(() => editor.exec({ type: 'SetHidden', id: 'missing', v: true }))
      && rejected(() => editor.exec({ type: 'SetHidden', id: hiddenId, v: true, extra: true }))
      && rejected(() => edit.applyPatches(doc, [{
        op: 'insert', path: ['slides', hiddenId, 'ovr', 'hidden'], origin: 'invalid',
      }]))
      && rejected(() => editor.exec(
        { type: 'SetHidden', id: inheritedId, v: true },
        { type: 'SetBackground', id: 'missing', fill: { type: 'none' } },
      ))
      && rejected(() => editor.exec(
        { type: 'SetHidden', id: solidId, v: true },
        { type: 'RemoveSlide', id: solidId },
      ))
      && JSON.stringify(doc) === atomicBefore && editor.history.undoCount === historyAtomic);
  unsubscribe();
  edit.disposeDoc(doc);
}
