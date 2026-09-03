const solid = (fill) => fill?.type === 'solid' ? fill.color : null;
const includesRgb = (fill, color) => solid(fill)?.includes(color);

function placeholderSignature(doc, slideId) {
  return doc.slides[slideId].children.map((id) => doc.elements[id])
    .filter((record) => record.meta.ph)
    .map((record) => `${record.meta.ph.type}:${record.meta.ph.index ?? 0}`)
    .sort();
}

function placeholder(doc, slideId, type) {
  return doc.slides[slideId].children.map((id) => doc.elements[id])
    .find((record) => record.meta.ph?.type === type);
}

function textContent(element) {
  return element?.kind === 'shape' ? element.text?.paragraphs
    .flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join('') ?? '' : '';
}

function integrationState(edit, doc, editor, ids) {
  const theme = edit.queryTheme(doc, edit.listThemes(doc)[0].id);
  const master = edit.queryMaster(doc, edit.listMasters(doc)[0].target);
  const layout = edit.queryLayout(doc, edit.listLayouts(doc)
    .find(({ name }) => name === '标题和内容').target);
  const content = editor.toSlide(ids.contentSlide);
  const blank = editor.toSlide(ids.blankSlide);
  return {
    accent1: theme.colors.accent1,
    minorLatin: theme.fonts.minor.latin,
    masterBackground: solid(master.background.value),
    masterBodyFont: master.textStyles.body[0].value.run.font,
    layoutBackground: solid(layout.background.value),
    contentBackground: solid(content.background),
    blankBackground: solid(blank.background),
    placeholders: placeholderSignature(doc, ids.contentSlide),
    titleFill: solid(editor.effectiveElement(ids.title).fill),
    titleText: textContent(editor.effectiveElement(ids.title)),
    bodyText: textContent(editor.effectiveElement(ids.body)),
    marker: content.elements.some((element) => element.name === ids.markerName),
    slides: doc.slideOrder.map((id) => doc.layouts[doc.slides[id].layoutId]?.name),
  };
}

/** 0.7 跨能力验收只经模板与编辑公开入口观察，不借用保存器内部状态。 */
export async function runV07PermissionContract({ templates, core, edit, check }) {
  console.log('\n\x1b[36m▸ 0.7 普通页面与设计画布权限隔离\x1b[0m');
  const source = templates.createPptxFromTemplate('aurora');
  const presentation = await core.parse(source, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'v07-permission-' });
  const editor = new edit.Editor(doc);
  const layout = edit.listLayouts(doc).find(({ name }) => name === '标题和内容');
  const master = edit.listMasters(doc)[0];
  const masterElement = doc.masters[master.id].children[0];

  let targetCommandRejected = false;
  try {
    editor.exec({
      type: 'SetBackground', target: layout.target,
      fill: { type: 'solid', color: '#102030' },
    });
  } catch { targetCommandRejected = true; }
  check('普通页面 exec 拒绝携带设计目标的画布属性命令', targetCommandRejected);

  let elementCommandRejected = false;
  try {
    editor.exec({ type: 'SetXfrm', id: masterElement, x: 1 });
  } catch { elementCommandRejected = true; }
  check('普通页面 exec 拒绝母版或版式元素命令', elementCommandRejected);

  let transactionRejected = false;
  try {
    editor.transaction((transaction) => {
      transaction.exec({ type: 'SetXfrm', id: masterElement, x: 2 });
    }, '越权设计事务');
  } catch { transactionRejected = true; }
  check('普通页面 transaction 不能绕过设计画布权限', transactionRejected);

  let accessorRead = false;
  const accessorCommand = {
    target: layout.target, fill: { type: 'solid', color: '#102030' },
  };
  Object.defineProperty(accessorCommand, 'type', {
    enumerable: true,
    get() { accessorRead = true; return 'SetBackground'; },
  });
  let accessorRejected = false;
  try { editor.execDesign(layout.target, accessorCommand); }
  catch { accessorRejected = true; }
  check('设计画布在判定命令类型前拒绝访问器', accessorRejected && !accessorRead);

  const designShape = (x) => ({
    type: 'AddShape', target: layout.target, preset: 'rect',
    rect: { x, y: 560, w: 80, h: 40 },
  });
  editor.execDesign(layout.target, designShape(900));
  const firstShape = editor.selection.ids[0];
  editor.execDesign(layout.target, designShape(1000));
  const secondShape = editor.selection.ids[0];
  editor.execDesign(layout.target, { type: 'Group', ids: [firstShape, secondShape] });
  const designGroup = editor.selection.ids[0];
  const payload = edit.copyElements(doc, [doc.elements[designGroup].children[0]]);
  const childCount = doc.elements[designGroup].children.length;
  let nestedPasteRejected = false;
  try {
    editor.exec({
      type: 'PasteElements', payload, at: { parentId: designGroup, x: 920, y: 580 },
    });
  } catch { nestedPasteRejected = true; }
  check('普通页面 exec 不能经嵌套粘贴目标修改版式组合',
    nestedPasteRejected && doc.elements[designGroup].children.length === childCount);

  edit.disposeDoc(doc);
}

function editText(editor, id, text) {
  editor.exec({
    type: 'EditText', id,
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 }, text,
    }],
  });
}

async function parseTemplate(core, edit, bytes, idPrefix, recoveryFrames) {
  const presentation = await core.parse(bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix });
  return { doc, editor: new edit.Editor(doc, recoveryFrames ? { recoveryFrames } : {}) };
}

async function runTemplateJourney({ template, templates, core, edit, check, saveArtifact }) {
  const bytes = templates.createPptxFromTemplate(template.id);
  saveArtifact(`${template.id}-source.pptx`, bytes);
  const prefix = `v07-${template.id}-`;
  const source = await parseTemplate(core, edit, bytes, prefix);
  const { doc, editor } = source;
  const frames = [];
  const stopRecovery = editor.subscribeRecovery((frame) => frames.push(frame));
  const theme = edit.listThemes(doc)[0];
  const master = edit.listMasters(doc)[0];
  const contentLayout = edit.listLayouts(doc).find(({ name }) => name === '标题和内容');
  const blankLayout = edit.listLayouts(doc).find(({ name }) => name === '空白');
  const contentResult = editor.exec({
    type: 'AddSlide', layoutId: contentLayout.id, at: { after: doc.slideOrder[0] },
  });
  const contentSlide = [...contentResult.createdSlides][0];
  const blankResult = editor.exec({
    type: 'AddSlide', layoutId: blankLayout.id, at: { after: contentSlide },
  });
  const blankSlide = [...blankResult.createdSlides][0];
  const title = placeholder(doc, contentSlide, 'title');
  const body = placeholder(doc, contentSlide, 'body');
  const beforePlaceholders = placeholderSignature(doc, contentSlide);
  const markerName = `V07-${template.id}-版式标记`;
  const ids = { contentSlide, blankSlide, title: title.id, body: body.id, markerName };

  editText(editor, title.id, `${template.name} 0.7 验收`);
  editText(editor, body.id, '主题、母版、版式与页面直接编辑');
  editor.exec({
    type: 'SetTheme', id: theme.id,
    clrScheme: { accent1: '#2468AC' },
    fontScheme: { minor: { latin: `V07 ${template.id}` } },
  });
  editor.execDesign(master.target,
    {
      type: 'SetBackground', target: master.target,
      fill: { type: 'solid', color: '#122033' },
    },
    {
      type: 'SetMasterTextStyle', target: master.target, category: 'body', level: 0,
      run: { font: `V07 ${template.id}` },
    });
  editor.execDesign(contentLayout.target, {
    type: 'SetBackground', target: contentLayout.target,
    fill: { type: 'solid', color: '#EEF2F7' },
  });
  editor.execDesign(contentLayout.target, {
    type: 'AddShape', target: contentLayout.target, preset: 'roundRect',
    rect: { x: 940, y: 610, w: 220, h: 54 },
  });
  const marker = editor.selection.kind === 'elements' ? editor.selection.ids[0] : null;
  editor.execDesign(contentLayout.target,
    { type: 'SetName', id: marker, name: markerName },
    { type: 'SetFill', id: marker, fill: { type: 'solid', color: '#2468AC' } });
  editor.exec({ type: 'SetFill', id: title.id, fill: { type: 'solid', color: '#F04A71' } });
  const beforeUndo = integrationState(edit, doc, editor, ids);
  editor.undo();
  const directFillUndone = solid(editor.effectiveElement(title.id).fill) !== 'rgb(240,74,113)';
  editor.redo();
  const current = integrationState(edit, doc, editor, ids);
  const masterMarker = doc.masters[master.id].children.map((id) => doc.elements[id])
    .find((record) => !record.meta.ph);

  check(`${template.name}统一旅程传播主题、母版、版式与直接覆盖`,
    includesRgb(editor.effectiveElement(masterMarker.id).fill, '36,104,172')
      && current.masterBackground === 'rgb(18,32,51)'
      && current.layoutBackground === 'rgb(238,242,247)'
      && current.contentBackground === 'rgb(238,242,247)'
      && current.blankBackground === 'rgb(18,32,51)'
      && current.titleFill === 'rgb(240,74,113)'
      && current.marker);
  check(`${template.name}直接覆盖可撤销重做且占位符身份不漂移`,
    directFillUndone && JSON.stringify(beforeUndo) === JSON.stringify(current)
      && JSON.stringify(beforePlaceholders) === JSON.stringify(current.placeholders));
  check(`${template.name}文本与母版正文默认值共存`,
    current.titleText.includes(`${template.name} 0.7`)
      && current.bodyText.includes('主题、母版、版式')
      && current.masterBodyFont === `V07 ${template.id}`
      && current.minorLatin === `V07 ${template.id}`);

  stopRecovery();
  const persistedFrames = JSON.parse(JSON.stringify(frames));
  const recovered = await parseTemplate(core, edit, bytes, prefix, persistedFrames);
  const recoveredState = integrationState(edit, recovered.doc, recovered.editor, ids);
  check(`${template.name}全链设计与页面补丁可序列化恢复`,
    recovered.editor.isDirty()
      && JSON.stringify(recoveredState) === JSON.stringify(current));

  const finalSlide = recovered.editor.exec({
    type: 'AddSlide', layoutId: contentLayout.id, at: { after: recovered.doc.slideOrder.at(-1) },
  });
  const finalSlideId = [...finalSlide.createdSlides][0];
  const saved = await recovered.editor.saveDetailed();
  const artifactName = `${template.id}-v07-patch.pptx`;
  saveArtifact(artifactName, saved.bytes);
  check(`${template.name}恢复后可继续新增并补丁保存`,
    finalSlideId && saved.mode !== 'identity'
      && saved.preservedEntries > 0 && saved.rewrittenEntries > 0 && !recovered.editor.isDirty());

  const reopened = await parseTemplate(core, edit, saved.bytes, `${prefix}reopen-`);
  const reopenedContentSlides = reopened.doc.slideOrder.filter((id) =>
    reopened.doc.layouts[reopened.doc.slides[id].layoutId]?.name === '标题和内容');
  const reopenedEdited = reopenedContentSlides.find((id) => {
    const record = placeholder(reopened.doc, id, 'title');
    return record && solid(reopened.editor.effectiveElement(record.id).fill) === 'rgb(240,74,113)';
  });
  const reopenedBlank = reopened.doc.slideOrder.find((id) =>
    reopened.doc.layouts[reopened.doc.slides[id].layoutId]?.name === '空白');
  const reopenedMaster = edit.queryMaster(reopened.doc, edit.listMasters(reopened.doc)[0].target);
  const reopenedLayout = edit.queryLayout(reopened.doc, edit.listLayouts(reopened.doc)
    .find(({ name }) => name === '标题和内容').target);
  check(`${template.name}保存重开保留继承、直接覆盖与占位符身份`,
    reopened.doc.slideOrder.length === 4 && reopenedContentSlides.length === 2
      && edit.queryTheme(reopened.doc, edit.listThemes(reopened.doc)[0].id).colors.accent1
        === 'rgb(36,104,172)'
      && solid(reopenedMaster.background.value) === 'rgb(18,32,51)'
      && reopenedMaster.textStyles.body[0].value.run.font === `V07 ${template.id}`
      && solid(reopenedLayout.background.value) === 'rgb(238,242,247)'
      && reopenedEdited
      && JSON.stringify(placeholderSignature(reopened.doc, reopenedEdited))
        === JSON.stringify(beforePlaceholders)
      && reopened.editor.toSlide(reopenedEdited).elements.some((element) => element.name === markerName)
      && solid(reopened.editor.toSlide(reopenedBlank).background) === 'rgb(18,32,51)');

  edit.disposeDoc(reopened.doc);
  edit.disposeDoc(recovered.doc);
  edit.disposeDoc(doc);
  return { file: artifactName, slides: 4 };
}

async function runPptSaveAsJourney({ core, edit, load, check, saveArtifact }) {
  const input = load('sample.ppt');
  const presentation = await core.parse(input, { edit: true, lazy: false, assets: 'defer' });
  const doc = edit.createDoc(presentation, { idPrefix: 'v07-ppt-' });
  const editor = new edit.Editor(doc);
  const target = Object.values(doc.elements)
    .find((record) => record.meta.editable === 'full' && Number.isFinite(record.src.x));
  const expectedX = target.src.x + 7;
  editor.exec({ type: 'SetXfrm', id: target.id, x: expectedX });
  const saved = await editor.saveDetailed();
  const file = 'ppt-v07-save-as.pptx';
  saveArtifact(file, saved.bytes);
  const reopened = await core.parse(saved.bytes, { lazy: false, assets: 'defer' });
  check('旧 .ppt 经统一模型编辑后生成为可重开 PPTX',
    doc.meta.source === 'ppt' && saved.mode === 'repacked'
      && saved.rewrittenEntries > 0 && saved.bytes[0] === 0x50 && saved.bytes[1] === 0x4B
      && reopened.slides.length === doc.slideOrder.length
      && reopened.slides.some((slide) => slide.elements.some((element) =>
        element.kind === target.src.kind && Math.abs(element.x - expectedX) < 0.01)),
  JSON.stringify({
    source: doc.meta.source, mode: saved.mode, rewritten: saved.rewrittenEntries,
    slides: [reopened.slides.length, doc.slideOrder.length], target: target.src.name,
    expectedX, candidates: reopened.slides.flatMap((slide) => slide.elements)
      .filter((element) => element.kind === target.src.kind).map((element) => element.x),
  }));
  const slides = reopened.slides.length;
  reopened.dispose?.();
  edit.disposeDoc(doc);
  return { file, slides };
}

export async function runV07IntegrationContract(deps) {
  console.log('\n\x1b[36m▸ 0.7 模板到保存重开统一旅程\x1b[0m');
  const artifacts = [];
  for (const template of deps.templates.listBuiltinTemplates()) {
    artifacts.push({ file: `${template.id}-source.pptx`, slides: 1 });
    artifacts.push(await runTemplateJourney({ ...deps, template }));
  }
  artifacts.push(await runPptSaveAsJourney(deps));
  return artifacts;
}
