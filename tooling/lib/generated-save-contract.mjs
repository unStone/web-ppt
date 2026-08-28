import { equalBytes } from './bytes.mjs';

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const bytesOf = (base64) => Uint8Array.from(Buffer.from(base64, 'base64'));

/** 生成保存只从公开入口和最终 PPTX 观察，不读取生成器内部状态。 */
export async function runGeneratedSaveContract({
  core, edit, generate, load, check, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ 生成式 PPTX 保存\x1b[0m');
  if (!check('公开按需生成入口', typeof generate.generateEditDoc === 'function')) return;

  if (check('公开按需空白 PPTX 入口', typeof generate.createBlankPptx === 'function')) {
    const blank = generate.createBlankPptx();
    const blankPresentation = await core.parse(blank, {
      edit: true, keepPackage: true, lazy: false, assets: 'defer',
    });
    const blankDoc = edit.createDoc(blankPresentation, { idPrefix: 'blank-new-' });
    const blankEditor = new edit.Editor(blankDoc);
    check('空白 PPTX 默认 16:9、带一页与三种真实版式',
      blankPresentation.width === 1280 && blankPresentation.height === 720
        && blankDoc.slideOrder.length === 1
        && JSON.stringify(blankDoc.layoutOrder.map((id) => blankDoc.layouts[id].name))
          === JSON.stringify(['标题页', '标题和内容', '空白'])
        && blankDoc.slides[blankDoc.slideOrder[0]].layoutId
          === blankDoc.layoutOrder.find((id) => blankDoc.layouts[id].name === '空白'));

    const custom = generate.createBlankPptx({ width: 960, height: 540 });
    const customPresentation = await core.parse(custom, { lazy: false });
    check('空白 PPTX 尺寸可覆盖',
      customPresentation.width === 960 && customPresentation.height === 540);
    customPresentation.dispose?.();

    const firstSlide = blankDoc.slideOrder[0];
    const contentLayout = blankDoc.layoutOrder.find((id) => blankDoc.layouts[id].name === '标题和内容');
    const added = blankEditor.exec({
      type: 'AddSlide', layoutId: contentLayout, at: { after: firstSlide },
    });
    const secondSlide = [...added.createdSlides][0];
    const title = blankDoc.slides[secondSlide].children.map((id) => blankDoc.elements[id])
      .find((record) => record.meta.ph?.type === 'title');
    blankEditor.exec({
      type: 'EditText', id: title.id,
      ops: [{
        type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 },
        text: '从空白开始',
      }],
    });
    blankEditor.exec({
      type: 'AddShape', slideId: firstSlide, preset: 'roundRect',
      rect: { x: 96, y: 88, w: 320, h: 160 },
    });
    const shapeId = blankEditor.selection.ids[0];
    blankEditor.exec({
      type: 'EditText', id: shapeId,
      ops: [{
        type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 },
        text: '可编辑文字',
      }],
    });
    blankEditor.exec({
      type: 'AddTable', slideId: firstSlide, rows: 2, cols: 2,
      rect: { x: 480, y: 88, w: 480, h: 220 },
    });
    const tableId = blankEditor.selection.ids[0];
    blankEditor.exec({
      type: 'AddImage', slideId: firstSlide, bytes: bytesOf(PNG_1PX), mime: 'image/png',
      rect: { x: 96, y: 360, w: 160, h: 160 },
    });
    const imageId = blankEditor.selection.ids[0];
    blankEditor.undo();
    const imageUndone = !blankDoc.elements[imageId];
    blankEditor.redo();
    check('空白文稿插入形状文字、图片、表格并可撤销重做', imageUndone
      && blankDoc.elements[shapeId]?.src.kind === 'shape'
      && blankDoc.elements[tableId]?.src.kind === 'table'
      && blankDoc.elements[imageId]?.src.kind === 'image');
    blankEditor.exec({ type: 'Group', ids: [shapeId, tableId] });
    const blankGroupId = blankEditor.selection.ids[0];
    const blankGrouped = blankDoc.elements[blankGroupId];
    blankEditor.exec({ type: 'Ungroup', id: blankGroupId });
    check('空白文稿的生成模型支持组合→解组并恢复孩子直属身份',
      blankGrouped?.src.kind === 'group' && !blankDoc.elements[blankGroupId]
        && [shapeId, tableId].every((id) => blankDoc.elements[id]?.parent === firstSlide));
    const dynamicNumber = blankDoc.slides[secondSlide].dynamicSlideNumbers
      .map((id) => blankEditor.effectiveElement(id))
      .find((element) => element.kind === 'shape');
    check('空白文稿新增页的动态页码使用最终页序', dynamicNumber?.kind === 'shape'
      && dynamicNumber.text?.paragraphs.some((paragraph) => paragraph.runs.some((run) =>
        run.field === 'slidenum' && run.text === '2')));

    const projectionFingerprint = (slides) => JSON.stringify(slides, (key, value) => {
      if (key === 'id' || key === 'editInfo' || key === 'name') return undefined;
      // 统一 Schema 中“显式无值”和“未写可选值”对投影等价；指纹只观察有效语义。
      if (value === null) return undefined;
      if (typeof value === 'string' && /^(?:blob:|asset:|data:)/.test(value)) return '<asset>';
      return value;
    });
    const projected = projectionFingerprint(blankDoc.slideOrder.map((id) => blankEditor.toSlide(id)));
    const blankSaved = await blankEditor.saveDetailed();
    check('空白文稿保存保留插入图片的原始字节',
      Object.entries(blankSaved.package.parts).some(([part, value]) =>
        part.startsWith('ppt/media/') && equalBytes(value, bytesOf(PNG_1PX))));
    saveArtifact('blank-new-document.pptx', blankSaved.bytes);
    const blankReopened = await core.parse(blankSaved.bytes, {
      edit: true, keepPackage: true, lazy: false, assets: 'defer',
    });
    const blankReopenedDoc = edit.createDoc(blankReopened, { idPrefix: 'blank-reopened-' });
    const blankReopenedEditor = new edit.Editor(blankReopenedDoc);
    const reopenedProjection = projectionFingerprint(
      blankReopenedDoc.slideOrder.map((id) => blankReopenedEditor.toSlide(id)),
    );
    const mismatch = [...projected].findIndex((char, index) => char !== reopenedProjection[index]);
    check('空白文稿保存重开后的投影指纹一致', reopenedProjection === projected,
      `${projected.length} != ${reopenedProjection.length} @${mismatch}: `
        + `${projected.slice(Math.max(0, mismatch - 120), mismatch + 180)} != `
        + reopenedProjection.slice(Math.max(0, mismatch - 120), mismatch + 180));
    edit.disposeDoc(blankReopenedDoc);
    edit.disposeDoc(blankDoc);
  }

  const doc = edit.createEmptyDoc({ width: 1280, height: 720, idPrefix: 'generated-empty-' });
  const first = generate.generateEditDoc(doc);
  const second = generate.generateEditDoc(doc);
  check('同一空白 EditDoc 连续生成逐字节一致且不采用生成包',
    equalBytes(first.bytes, second.bytes) && doc.package === null);
  check('空白生成物闭包包含演示、主题、母版与版式', [
    '[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml',
    'ppt/_rels/presentation.xml.rels', 'ppt/theme/theme1.xml',
    'ppt/slideMasters/slideMaster1.xml', 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    'ppt/slideLayouts/slideLayout1.xml', 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
  ].every((part) => first.package.parts[part]?.length));

  const reopened = await core.parse(first.bytes, { edit: true, lazy: false, assets: 'defer' });
  check('空白生成物可由公开解析器重开并保持尺寸与页数', reopened.source === 'pptx'
    && reopened.width === 1280 && reopened.height === 720 && reopened.slides.length === 0);
  reopened.dispose?.();
  saveArtifact('generated-empty.pptx', first.bytes);

  const source = await core.parse(load('sample-generated-save.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const content = edit.createDoc(source, { idPrefix: 'generated-content-' });
  const editor = new edit.Editor(content);
  const slideId = content.slideOrder[0];
  const sourceKinds = edit.toSlide(content, slideId).elements.map((element) => element.kind).sort();
  check('生成固件同时覆盖形状、图片填充、页面图片背景、表格与备注',
    JSON.stringify(sourceKinds) === JSON.stringify(['image', 'image', 'shape', 'shape', 'shape', 'table'])
    && edit.toSlide(content, slideId).background?.type === 'image'
    && edit.querySlideNotes(content, [slideId]).value === '生成备注第一行\n生成备注第二行');
  source.dispose?.();
  check('来源原包释放后进入生成保存而非补丁路径', content.package?.disposed === true);
  const generated = generate.generateEditDoc(content);
  const editorGenerated = await editor.saveDetailed();
  const editorGeneratedAgain = await editor.saveDetailed();
  check('Editor.saveDetailed 自动选择生成路径且连续保存确定',
    equalBytes(editorGenerated.bytes, generated.bytes)
    && equalBytes(editorGeneratedAgain.bytes, generated.bytes)
    && content.package?.disposed === true && !editor.isDirty());
  const contentPath = saveArtifact('generated-content.pptx', generated.bytes);
  const contentReopened = await core.parse(generated.bytes, { lazy: false, assets: 'defer' });
  check('单页多元素与备注生成物可重开', contentReopened.slides.length === 1
    && contentReopened.slides[0].elements.some((element) => element.name === '生成形状')
    && contentReopened.slides[0].elements.some((element) => element.name === '生成形状'
      && element.link === 'https://example.com/generated'
      && element.kind === 'shape'
      && element.text?.paragraphs.some((paragraph) => paragraph.runs
        .some((run) => run.link === 'https://example.com/generated')))
    && contentReopened.slides[0].elements.some((element) => element.name === '生成图片填充'
      && element.kind === 'shape' && element.fill?.type === 'image')
    && contentReopened.slides[0].elements.some((element) => element.name === '生成自由形状'
      && element.kind === 'shape' && element.path?.includes('Q') && element.path.includes('A'))
    && contentReopened.slides[0].elements.some((element) => element.kind === 'image')
    && contentReopened.slides[0].elements.some((element) => element.name === '生成音频'
      && element.kind === 'image' && element.media?.kind === 'audio')
    && contentReopened.slides[0].elements.some((element) => element.kind === 'table')
    && contentReopened.slides[0].background?.type === 'image'
    && contentReopened.slides[0].notes === '生成备注第一行\n生成备注第二行');
  contentReopened.dispose?.();
  const before = renderFingerprint('sample-generated-save.pptx', 'projected');
  const after = renderFingerprint(contentPath, 'saved');
  check('生成前后两条文本路径的独立进程指纹一致', JSON.stringify(after) === JSON.stringify(before),
    `${JSON.stringify(before)} != ${JSON.stringify(after)}`);
  edit.disposeDoc(content);

  const legacySource = await core.parse(load('sample.ppt'), {
    edit: true, lazy: false, assets: 'defer',
  });
  const legacyDoc = edit.createDoc(legacySource, { idPrefix: 'generated-ppt-' });
  const legacySaved = await new edit.Editor(legacyDoc).saveDetailed();
  const legacyPath = saveArtifact('generated-ppt-source.pptx', legacySaved.bytes);
  const legacyReopened = await core.parse(legacySaved.bytes, { lazy: false, assets: 'defer' });
  check('.ppt EditDoc 自动另存为可重开的 PPTX', legacyDoc.meta.source === 'ppt'
    && legacyReopened.source === 'pptx'
    && legacyReopened.slides.length === legacySource.slides.length);
  legacyReopened.dispose?.();
  const legacyBefore = renderFingerprint('sample.ppt', 'projected');
  const legacyAfter = renderFingerprint(legacyPath, 'saved');
  check('.ppt 另存前后两条文本路径的独立进程指纹一致',
    JSON.stringify(legacyAfter) === JSON.stringify(legacyBefore),
    `${JSON.stringify(legacyBefore)} != ${JSON.stringify(legacyAfter)}`);
  edit.disposeDoc(legacyDoc);

  const editedLegacySource = await core.parse(load('sample.ppt'), {
    edit: true, lazy: false, assets: 'defer',
  });
  const editedLegacyDoc = edit.createDoc(editedLegacySource, { idPrefix: 'generated-ppt-edited-' });
  const editedLegacy = new edit.Editor(editedLegacyDoc);
  const editedSlideId = editedLegacyDoc.slideOrder[0];
  const sourceKindCounts = edit.toSlide(editedLegacyDoc, editedSlideId).elements
    .reduce((counts, element) => ({ ...counts, [element.kind]: (counts[element.kind] ?? 0) + 1 }), {});
  editedLegacy.exec({
    type: 'AddShape', slideId: editedSlideId, preset: 'roundRect',
    rect: { x: 80, y: 60, w: 240, h: 120 },
  });
  const shapeId = editedLegacy.selection.ids[0];
  editedLegacy.exec({
    type: 'AddTable', slideId: editedSlideId, rows: 2, cols: 3,
    rect: { x: 350, y: 60, w: 420, h: 160 },
  });
  const tableId = editedLegacy.selection.ids[0];
  editedLegacy.exec({
    type: 'AddImage', slideId: editedSlideId, bytes: bytesOf(PNG_1PX), mime: 'image/png',
    rect: { x: 800, y: 60, w: 120, h: 120 },
  });
  const imageId = editedLegacy.selection.ids[0];
  check('.ppt 生成编辑的形状、表格与图片只写统一模型',
    [shapeId, tableId, imageId].every((id) => editedLegacyDoc.elements[id]?.meta.created
      && !editedLegacyDoc.elements[id].meta.origin && !editedLegacyDoc.elements[id].meta.insertion)
      && Object.keys(editedLegacyDoc.imageResources).length === 1);
  editedLegacy.undo();
  const removedImage = !editedLegacyDoc.elements[imageId];
  editedLegacy.redo();
  check('.ppt 生成插入复用结构历史且不丢图片资源', removedImage
    && editedLegacyDoc.elements[imageId]?.src.kind === 'image'
    && Object.keys(editedLegacyDoc.imageResources).length === 1);
  editedLegacy.exec({ type: 'Group', ids: [shapeId, tableId, imageId] });
  const legacyGroupId = editedLegacy.selection.ids[0];
  const legacyGroupedBytes = generate.generateEditDoc(editedLegacyDoc).bytes;
  const legacyGroupedReopened = await core.parse(legacyGroupedBytes, { lazy: false, assets: 'defer' });
  const generatedGroup = legacyGroupedReopened.slides[0].elements.find((element) =>
    element.kind === 'group' && element.children.length === 3);
  check('.ppt 统一模型中的新组合可生成并由公开解析器重开', generatedGroup?.kind === 'group'
    && generatedGroup.children.map((element) => element.kind).sort().join(',') === 'image,shape,table');
  legacyGroupedReopened.dispose?.();
  editedLegacy.exec({ type: 'Ungroup', id: legacyGroupId });
  check('.ppt 统一模型解组后恢复三种插入的直属身份',
    !editedLegacyDoc.elements[legacyGroupId]
      && [shapeId, tableId, imageId].every((id) => editedLegacyDoc.elements[id]?.parent === editedSlideId));
  const editedLegacySaved = await editedLegacy.saveDetailed();
  saveArtifact('generated-ppt-edited.pptx', editedLegacySaved.bytes);
  const editedLegacyReopened = await core.parse(editedLegacySaved.bytes, { lazy: false, assets: 'defer' });
  const savedKindCounts = editedLegacyReopened.slides[0].elements
    .reduce((counts, element) => ({ ...counts, [element.kind]: (counts[element.kind] ?? 0) + 1 }), {});
  check('.ppt 确认后三种插入能生成并重开',
    savedKindCounts.shape === (sourceKindCounts.shape ?? 0) + 1
      && savedKindCounts.table === (sourceKindCounts.table ?? 0) + 1
      && savedKindCounts.image === (sourceKindCounts.image ?? 0) + 1
      && editedLegacyReopened.slides.length === editedLegacySource.slides.length);
  editedLegacyReopened.dispose?.();
  edit.disposeDoc(editedLegacyDoc);

  const unsupportedSource = await core.parse(load('sample-ppt-unsupported.ppt'), {
    edit: true, lazy: false, assets: 'defer',
  });
  const unsupportedDoc = edit.createDoc(unsupportedSource, { idPrefix: 'generated-ppt-unsupported-' });
  const unsupportedEditor = new edit.Editor(unsupportedDoc);
  const unsupportedRecords = Object.values(unsupportedDoc.elements);
  const unsupportedRecord = unsupportedRecords.find((record) =>
    record.src.kind === 'unsupported' && record.src.label.includes('MSOSPT 300'));
  const oleRecord = unsupportedRecords.find((record) =>
    record.src.kind === 'unsupported' && record.src.label.includes('OLE'));
  check('.ppt 未知形状与 OLE 以 frame 而非普通图形进入编辑模型',
    unsupportedRecord?.meta.editable === 'frame' && oleRecord?.meta.editable === 'frame');
  unsupportedEditor.exec({
    type: 'SetXfrm', id: unsupportedRecord.id,
    x: unsupportedRecord.src.x + 24, y: unsupportedRecord.src.y + 12,
  });
  const unsupportedSaved = await unsupportedEditor.saveDetailed();
  saveArtifact('generated-ppt-unsupported.pptx', unsupportedSaved.bytes);
  const unsupportedReopened = await core.parse(unsupportedSaved.bytes, { lazy: false, assets: 'defer' });
  const generatedElements = unsupportedReopened.slides.flatMap((slide) => slide.elements);
  const generatedPlaceholder = generatedElements.find((element) =>
    element.kind === 'shape' && element.text?.paragraphs.some((paragraph) =>
      paragraph.runs.some((run) => run.text.includes('MSOSPT 300'))));
  const generatedOlePlaceholder = generatedElements.find((element) =>
    element.kind === 'shape' && element.text?.paragraphs.some((paragraph) =>
      paragraph.runs.some((run) => run.text.includes('OLE'))));
  check('.ppt 未知形状与 OLE 另存后以显式原因占位生成并重开',
    generatedPlaceholder?.kind === 'shape'
      && generatedPlaceholder.x === unsupportedRecord.src.x + 24
      && generatedPlaceholder.y === unsupportedRecord.src.y + 12
      && generatedOlePlaceholder?.kind === 'shape');
  unsupportedReopened.dispose?.();
  edit.disposeDoc(unsupportedDoc);

  const oleSource = await core.parse(load('sample-chart.ppt'), {
    edit: true, lazy: false, assets: 'defer',
  });
  const oleSlide = oleSource.slides.find((slide) =>
    slide.elements.some((element) => element.kind === 'unsupported' && !!element.preview));
  const olePreview = oleSlide?.elements.find((element) =>
    element.kind === 'unsupported' && !!element.preview);
  const oleOnlySource = {
    ...oleSource,
    slides: oleSlide && olePreview ? [{ ...oleSlide, elements: [olePreview] }] : [],
  };
  const oleDoc = edit.createDoc(oleOnlySource, { idPrefix: 'generated-ppt-ole-preview-' });
  const oleSaved = await new edit.Editor(oleDoc).saveDetailed();
  saveArtifact('generated-ppt-ole-preview.pptx', oleSaved.bytes);
  const oleReopened = await core.parse(oleSaved.bytes, { lazy: false, assets: 'defer' });
  const olePlaceholder = oleReopened.slides[0]?.elements.find((element) =>
    element.kind === 'shape' && element.fill?.type === 'image'
      && element.text?.paragraphs.some((paragraph) =>
        paragraph.runs.some((run) => run.text.includes('OLE'))));
  check('.ppt OLE 另存后同时保留静态预览与显式原因',
    oleDoc.slideOrder.length === 1 && olePlaceholder?.kind === 'shape');
  oleReopened.dispose?.();
  edit.disposeDoc(oleDoc);

  const hiddenSource = await core.parse(load('sample-hidden.ppt'), {
    edit: true, lazy: false, assets: 'defer',
  });
  const hiddenDoc = edit.createDoc(hiddenSource, { idPrefix: 'generated-hidden-' });
  const hiddenSaved = await new edit.Editor(hiddenDoc).saveDetailed();
  const hiddenReopened = await core.parse(hiddenSaved.bytes, { lazy: false, assets: 'defer' });
  check('.ppt 隐藏页语义进入生成包',
    JSON.stringify(hiddenReopened.slides.map((slide) => !!slide.hidden))
      === JSON.stringify(hiddenSource.slides.map((slide) => !!slide.hidden)));
  hiddenReopened.dispose?.();
  edit.disposeDoc(hiddenDoc);

  const groupSource = await core.parse(load('showcase.ppt'), {
    edit: true, lazy: false, assets: 'inline',
  });
  const groupDoc = edit.createDoc(groupSource, { idPrefix: 'generated-group-' });
  const sourceGroups = groupSource.slides.flatMap((slide) => slide.elements)
    .filter((element) => element.kind === 'group').length;
  const groupSaved = generate.generateEditDoc(groupDoc);
  const groupReopened = await core.parse(groupSaved.bytes, { lazy: false, assets: 'defer' });
  const reopenedGroups = groupReopened.slides.flatMap((slide) => slide.elements)
    .filter((element) => element.kind === 'group').length;
  check('.ppt 完整图文表格与组合树可生成并重开',
    groupReopened.slides.length === groupSource.slides.length
    && sourceGroups > 0 && reopenedGroups === sourceGroups,
    `${groupSource.slides.length}/${sourceGroups} != ${groupReopened.slides.length}/${reopenedGroups}`);
  groupReopened.dispose?.();
  edit.disposeDoc(groupDoc);
}
