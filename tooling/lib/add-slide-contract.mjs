const textOf = (shape) => shape.text?.paragraphs
  .flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join('') ?? '';

const rejected = (fn) => {
  try { fn(); return false; } catch { return true; }
};

/** AddSlide 只从公开解析结果、命令、有效投影与历史取证。 */
export async function runAddSlideContract({ edit, core, load, check, eq }) {
  console.log('\n\x1b[36m▸ AddSlide 版式目录、模型与历史\x1b[0m');
  const input = load('sample-editor-add-slide.pptx');
  if (!check('找到确定性新增页固件', !!input)) return;

  const plain = await core.parse(input, { lazy: false, assets: 'defer' });
  check('默认预览解析不携带编辑版式目录', plain.editInfo === undefined
    && plain.slides.every((slide) => slide.editInfo === undefined));
  plain.dispose?.();

  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const layouts = presentation.editInfo?.layouts;
  if (!check('编辑解析公开两种确定性版式', layouts?.length === 2,
    `实际 ${layouts?.length ?? 0}`)) {
    presentation.dispose?.();
    return;
  }
  const titleLayout = layouts.find((layout) => layout.name === '标题和正文');
  const blankLayout = layouts.find((layout) => layout.name === '空白');
  check('版式目录包含稳定 part 身份、静态投影和占位符模板',
    titleLayout?.id === 'ppt/slideLayouts/slideLayout1.xml'
      && blankLayout?.id === 'ppt/slideLayouts/slideLayout2.xml'
      && titleLayout.elements.some((element) => element.editInfo?.placeholder?.type === 'title')
      && titleLayout.elements.some((element) => element.editInfo?.placeholder?.type === 'body')
      && titleLayout.elements.some((element) => element.editInfo?.placeholder?.type === 'sldNum')
      && titleLayout.elements.some((element) => element.editInfo?.placeholder?.type === 'pic')
      && titleLayout.elements.some((element) =>
        element.name === '版式下一页链接' && element.link === 'slide:next')
      && blankLayout.elements.some((element) => element.name === '空白版式角标'));
  eq('既有页记录其真实版式身份', presentation.slides[0].editInfo?.layoutId, titleLayout.id);

  const doc = edit.createDoc(presentation, { idPrefix: 'add-slide-' });
  const editor = new edit.Editor(doc);
  const firstSlide = doc.slideOrder[0];
  const existingElement = doc.slides[firstSlide].children.find((id) =>
    doc.elements[id].meta.editable === 'full');
  const beforeIdentity = JSON.stringify(doc.identity);
  check('首次新增页后的批量失败会连惰性 OPC 身份字段一起回滚', rejected(() => editor.exec(
    { type: 'AddSlide', layoutId: titleLayout.id, at: { after: firstSlide } },
    { type: 'SetXfrm', id: existingElement, x: Number.NaN },
  ))
    && JSON.stringify(doc.identity) === beforeIdentity
    && doc.slideOrder.join(',') === firstSlide);
  const result = editor.exec({ type: 'AddSlide', layoutId: titleLayout.id, at: { after: firstSlide } });
  const createdId = [...result.createdSlides][0];
  const created = doc.slides[createdId];
  check('单条命令产生一个页树 patch、公开新页身份并插在稳定锚点后',
    result.forward.length === 1 && result.inverse.length === 1
      && result.forward[0].path[0] === 'slides' && result.forward[0].op === 'insert'
      && result.createdSlides.size === 1 && result.removedSlides.size === 0
      && result.dirtySlides.has(createdId)
      && doc.slideOrder.join(',') === `${firstSlide},${createdId}`);
  check('新页具有唯一可写 OPC 身份和所选版式关系',
    created?.origin?.part === 'ppt/slides/slide8.xml'
      && created.creation?.layoutPart === titleLayout.id
      && created.creation.presentationSlideId === 901
      && created.creation.presentationRelationshipId === 'rId78');

  const placeholderRecords = created.children.map((id) => doc.elements[id])
    .filter((record) => record.meta.ph);
  const projected = editor.toSlide(createdId);
  check('标题正文占位符继承版式几何但不复制提示文字',
    placeholderRecords.length === 4
      && placeholderRecords.every((record) => record.meta.created && record.meta.insertion
        && record.meta.origin?.part === created.origin.part && record.meta.editable === 'full')
      && projected.elements.filter((element) => ['title', 'body'].includes(
        element.editInfo?.placeholder?.type ?? '',
      )).every((element) =>
        element.kind === 'shape' && textOf(element) === '')
      && !JSON.stringify(projected).includes('单击此处'));
  check('页码占位符即时投影当前插入序号，保存源仍是字段而非普通文字',
    projected.elements.some((element) => element.kind === 'shape'
      && element.editInfo?.placeholder?.type === 'sldNum' && textOf(element) === '第 2 页'
      && element.text.paragraphs[0].runs.length === 3
      && element.text.paragraphs[0].runs[1].field === 'slidenum')
      && placeholderRecords.find((record) => record.meta.ph.type === 'sldNum')
        ?.meta.insertion.markup.includes('type="slidenum"'));
  const sameAnchorResult = editor.exec({
    type: 'AddSlide', layoutId: titleLayout.id, at: { after: firstSlide },
  });
  const sameAnchorId = [...sameAnchorResult.createdSlides][0];
  const pageNumber = (slideId) => editor.toSlide(slideId).elements.find((element) =>
    element.kind === 'shape' && element.editInfo?.placeholder?.type === 'sldNum');
  const createdPageNumberId = created.dynamicSlideNumbers.find((id) =>
    doc.elements[id].meta.origin?.part === created.origin.part);
  const createdTitleId = created.children.find((id) => doc.elements[id].meta.ph?.type === 'title');
  check('同锚点再次插页会让两页动态页码跟随最终页序并失效受影响页',
    doc.slideOrder.join(',') === `${firstSlide},${sameAnchorId},${createdId}`
      && textOf(pageNumber(sameAnchorId)) === '第 2 页'
      && textOf(pageNumber(createdId)) === '第 3 页'
      && sameAnchorResult.dirtySlides.has(createdId)
      && sameAnchorResult.dirtyElements.has(createdPageNumberId)
      && !sameAnchorResult.dirtyElements.has(createdTitleId));
  editor.undo();
  const leadingResult = editor.exec({ type: 'AddSlide', layoutId: titleLayout.id, at: { after: null } });
  const leadingId = [...leadingResult.createdSlides][0];
  const existingLink = editor.toSlide(firstSlide).elements.find((element) =>
    element.name === '现有页下一页链接');
  const stableTargetLink = editor.toSlide(firstSlide).elements.find((element) =>
    element.name === '现有页自身链接');
  const leadingLink = editor.toSlide(leadingId).elements.find((element) =>
    element.name === '版式下一页链接');
  check('置首插页后既有页与版式相对跳转按当前页序投影，不固化解析期页码',
    existingLink?.link === 'slide:3' && stableTargetLink?.link === 'slide:2'
      && leadingLink?.link === 'slide:2'
      && leadingResult.dirtyElements.has(doc.slides[firstSlide].dynamicSlideLinks.find((id) =>
        doc.elements[id].src.name === '现有页下一页链接')));
  editor.undo();
  check('母版与版式静态图形进入同一有效投影但保持不可编辑',
    projected.elements.some((element) => element.name === '母版标记')
      && projected.elements.some((element) => element.name === '版式色带')
      && created.children.map((id) => doc.elements[id])
        .filter((record) => ['母版标记', '版式色带'].includes(record.src.name))
        .every((record) => record.meta.editable === 'none'));

  const observed = [];
  const unsubscribe = editor.subscribe((change) => observed.push(change));
  editor.undo();
  check('撤销删除新页并公开 removedSlides，且成功事务不回收身份水位',
    !doc.slides[createdId] && doc.slideOrder.join(',') === firstSlide
      && observed.at(-1).removedSlides.has(createdId)
      && JSON.stringify(doc.identity) !== beforeIdentity);
  editor.redo();
  check('重做恢复同一页、元素和 OPC 身份',
    doc.slides[createdId]?.creation.presentationSlideId === 901
      && [...observed.at(-1).createdSlides].join(',') === createdId
      && doc.slides[createdId].children.join(',') === created.children.join(','));
  unsubscribe();

  const blankResult = editor.exec({ type: 'AddSlide', layoutId: blankLayout.id, at: { after: createdId } });
  const blankId = [...blankResult.createdSlides][0];
  check('空白版式只投影母版与自身静态图形，不伪造占位符',
    doc.slides[blankId].children.every((id) => !doc.elements[id].meta.ph)
      && editor.toSlide(blankId).elements.some((element) => element.name === '空白版式角标')
      && !editor.toSlide(blankId).elements.some((element) => element.name === '母版标记'));

  const beforeFailure = {
    identity: JSON.stringify(doc.identity), order: doc.slideOrder.join(','),
    selection: JSON.stringify(editor.selection),
  };
  check('拒绝未知版式、未知锚点、畸形 at 和额外命令字段',
    rejected(() => editor.exec({ type: 'AddSlide', layoutId: 'missing', at: { after: firstSlide } }))
      && rejected(() => editor.exec({ type: 'AddSlide', layoutId: titleLayout.id, at: { after: 'missing' } }))
      && rejected(() => editor.exec({ type: 'AddSlide', layoutId: titleLayout.id, at: {} }))
      && rejected(() => editor.exec({ type: 'AddSlide', layoutId: titleLayout.id,
        at: { after: firstSlide }, extra: true })));
  check('批量后段失败会原子回滚页树、身份与选区', rejected(() => editor.exec(
    { type: 'AddSlide', layoutId: titleLayout.id, at: { after: blankId } },
    { type: 'SetXfrm', id: 'missing-element', x: 10 },
  ))
    && JSON.stringify(doc.identity) === beforeFailure.identity
    && doc.slideOrder.join(',') === beforeFailure.order
    && JSON.stringify(editor.selection) === beforeFailure.selection);
  check('新增页后的 EditDoc 仍可 structuredClone', (() => {
    try { return structuredClone(doc).slideOrder.join(',') === doc.slideOrder.join(','); }
    catch { return false; }
  })());
  edit.disposeDoc(doc);
}
