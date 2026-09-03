import { unzipSync, zipSync } from 'fflate';

/** 母版只经公开目录、设计目标和结构化文字样式 seam 验收。 */
export async function runMasterEditContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ Master 设计目录与文字来源\x1b[0m');
  const input = load('sample-editor-master-editing.pptx');
  if (!check('找到双母版确定性固件', !!input)) return;
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const masters = presentation.editInfo?.masters ?? [];
  check('编辑解析按声明顺序返回母版 OPC 目录',
    masters.length === 2
      && masters[0].id === 'ppt/slideMasters/slideMaster1.xml'
      && masters[1].id === 'ppt/slideMasters/slideMaster2.xml'
      && masters[0].layoutIds.includes('ppt/slideLayouts/slideLayout1.xml')
      && masters[1].layoutIds.includes('ppt/slideLayouts/slideLayout2.xml')
      && masters[1].layoutIds.includes('ppt/slideLayouts/slideLayout3.xml')
      && masters.every((master) => master.themeId && master.textStyles.body.paragraphs.length === 9));
  check('母版目录不反向继承直属版式的直接背景',
    masters[1].background === null
      && presentation.editInfo.layouts.find((layout) =>
        layout.id === 'ppt/slideLayouts/slideLayout2.xml')?.directBackground === true);
  const parsedMasterTable = masters[1].elements.find((element) => element.name === '母版源表格');
  const parsedSlideTable = presentation.slides[2].elements
    .find((element) => element.name === '母版源表格');
  check('多主题文稿按有效主题分别求值文稿级文字默认值',
    parsedMasterTable?.kind === 'table' && parsedSlideTable?.kind === 'table'
      && parsedSlideTable.rows[0].cells[0].text.paragraphs[0].runs[0].fonts[0]
        === parsedMasterTable.rows[0].cells[0].text.paragraphs[0].runs[0].fonts[0]
      && parsedSlideTable.rows[0].cells[0].text.paragraphs[0].runs[0].fonts[0]
        === 'Target Theme Latin');

  const emptyLayoutParts = unzipSync(input);
  const masterPart = 'ppt/slideMasters/slideMaster2.xml';
  emptyLayoutParts[masterPart] = new TextEncoder().encode(
    new TextDecoder().decode(emptyLayoutParts[masterPart])
      .replace(/<p:sldLayoutIdLst>[\s\S]*?<\/p:sldLayoutIdLst>/, '<p:sldLayoutIdLst/>'),
  );
  const emptyLayoutPresentation = await core.parse(zipSync(emptyLayoutParts), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  check('没有直属版式的已声明母版仍保留在目录中',
    emptyLayoutPresentation.editInfo?.masters.some((master) =>
      master.id === masterPart && master.layoutIds.length === 0));
  emptyLayoutPresentation.dispose();

  const doc = edit.createDoc(presentation, { idPrefix: 'master-edit-' });
  const catalog = edit.listMasters(doc);
  check('公开母版目录返回稳定设计目标和直属版式集合',
    catalog.length === 2
      && catalog[0].target.kind === 'master'
      && catalog[0].target.id === catalog[0].id
      && catalog[0].layoutIds.length === masters[0].layoutIds.length
      && catalog[1].layoutIds.length === 2
      && doc.masters[catalog[0].id].children.some((id) =>
        doc.elements[id].src.name === '母版标记'));

  const sourceMaster = catalog[0];
  const targetMaster = catalog[1];
  const targetLayout = targetMaster.layoutIds[0];
  const inheritedLayout = targetMaster.layoutIds.find((id) => id.endsWith('slideLayout3.xml'));
  const inheritedSlide = doc.slideOrder.find((id) => doc.slides[id].layoutId === inheritedLayout);
  const inheritedBodyId = doc.slides[inheritedSlide].children.find((id) =>
    doc.elements[id].meta.origin?.part === doc.slides[inheritedSlide].origin.part
      && doc.elements[id].meta.ph?.type === 'body');
  const beforeInherited = editorOf(edit, doc).effectiveElement(inheritedBodyId).text.paragraphs;
  const beforeLastLink = editorOf(edit, doc).toSlide(inheritedSlide).elements
    .find((element) => element.name === '目标母版标记')?.link;
  const beforeSlideCount = doc.slideOrder.length;
  const sourceSlides = doc.slideOrder.filter((id) => doc.slides[id].layoutId === sourceMaster.layoutIds[0]);
  const added = editorOf(edit, doc).exec({
    type: 'AddSlide', layoutId: targetLayout, at: { after: doc.slideOrder.at(-1) },
  });
  const targetSlide = [...added.createdSlides][0];
  const editor = editorOf(edit, doc);
  const masterTable = doc.masters[targetMaster.id].children.map((id) => doc.elements[id])
    .find((element) => element.src.name === '母版源表格');
  const beforeTable = editor.effectiveElement(masterTable.id);
  editor.execDesign(targetMaster.target, { type: 'InsertRow', id: masterTable.id });
  const afterTable = editor.effectiveElement(masterTable.id);
  check('母版源元素覆盖只在主题来源上应用一次',
    beforeTable.kind === 'table' && afterTable.kind === 'table'
      && afterTable.rows.length === beforeTable.rows.length + 1
      && Math.abs((afterTable.h - beforeTable.h) - beforeTable.rows.at(-1).height) < 1e-9);
  editor.undo();
  check('母版虚拟节点的相对跳转在页序变化后清除整页缓存',
    beforeLastLink === `slide:${beforeSlideCount}`
      && editor.toSlide(inheritedSlide).elements
        .find((element) => element.name === '目标母版标记')?.link === `slide:${doc.slideOrder.length}`
      && added.dirtySlides.has(inheritedSlide));
  const marker = doc.masters[targetMaster.id].children.map((id) => doc.elements[id])
    .find((element) => element.src.name === '目标母版标记');
  const beforeCanvas = editor.toDesignCanvas(targetMaster.target);
  const moved = editor.execDesign(targetMaster.target, {
    type: 'SetXfrm', id: marker.id, x: marker.src.x + 43,
  });
  check('母版画布复用元素命令并只传播到该母版依赖页面',
    beforeCanvas.elements.find((element) => element.name === marker.src.name)?.x === marker.src.x
      && editor.toDesignCanvas(targetMaster.target).elements
        .find((element) => element.name === marker.src.name)?.x === marker.src.x + 43
      && editor.toSlide(targetSlide).elements
        .find((element) => element.name === marker.src.name)?.x === marker.src.x + 43
      && moved.renderSlides.has(targetSlide)
      && sourceSlides.every((id) => !moved.renderSlides.has(id)));

  const sourceMarker = doc.masters[sourceMaster.id].children.map((id) => doc.elements[id])
    .find((element) => element.src.name === '母版标记');
  editor.execDesign(sourceMaster.target, {
    type: 'SetXfrm', id: sourceMarker.id, x: sourceMarker.src.x + 17,
  });
  check('页面 showMasterSp=0 在母版进入编辑态后仍屏蔽母版图形',
    sourceSlides.every((id) => !editor.toSlide(id).elements
      .some((element) => element.name === sourceMarker.src.name)));
  check('母版设计命令拒绝页面专属能力和跨画布元素', (() => {
    try {
      editor.execDesign(targetMaster.target, { type: 'SetHidden', id: targetSlide, v: true });
      return false;
    } catch {
      try {
        editor.execDesign(targetMaster.target, { type: 'SetXfrm', id: sourceMarker.id, x: 1 });
        return false;
      } catch { return true; }
    }
  })());

  const sourceState = edit.queryMaster(doc, sourceMaster.target);
  const background = editor.execDesign(sourceMaster.target, {
    type: 'SetBackground', target: sourceMaster.target,
    fill: { type: 'solid', color: '#203040' },
  });
  const queried = edit.queryMaster(doc, sourceMaster.target);
  check('母版背景保留来源值、建立稀疏覆盖并传播到继承页面',
    sourceState.background.direct === false
      && queried.background.direct === true
      && solid(queried.background.value) === 'rgb(32,48,64)'
      && solid(queried.background.source) !== solid(queried.background.value)
      && sourceSlides.every((id) => solid(editor.toSlide(id).background) === 'rgb(32,48,64)')
      && sourceSlides.every((id) => background.renderSlides.has(id))
      && !background.renderSlides.has(targetSlide));

  const inserted = editor.execDesign(targetMaster.target, {
    type: 'AddShape', target: targetMaster.target, preset: 'ellipse',
    rect: { x: 80, y: 70, w: 140, h: 60 },
  });
  const insertedId = editor.selection.kind === 'elements' ? editor.selection.ids[0] : null;
  check('母版画布复用新增和结构命令且使用母版 OPC 宿主',
    !!insertedId && doc.elements[insertedId]?.parent === targetMaster.id
      && doc.elements[insertedId]?.meta.origin?.part === targetMaster.id
      && inserted.renderSlides.has(targetSlide));

  const textSource = edit.queryMaster(doc, targetMaster.target).textStyles;
  const textChange = editor.execDesign(targetMaster.target, {
    type: 'SetMasterTextStyle', target: targetMaster.target,
    category: 'body', level: 1,
    paragraph: { align: 'right', bullet: { kind: 'autoNum', type: 'arabicPeriod', startAt: 3 } },
    run: { font: 'Aptos', size: 30, color: '#4263eb', b: false },
  });
  const textState = edit.queryMaster(doc, targetMaster.target).textStyles.body[1];
  const inheritedParagraphs = editor.effectiveElement(inheritedBodyId).text.paragraphs;
  check('母版三类九级文字默认值独立暴露来源、有效值与稀疏覆盖',
    textSource.title.length === 9 && textSource.body.length === 9 && textSource.other.length === 9
      && textState.source.run.font !== textState.value.run.font
      && textState.value.paragraph.align === 'right'
      && textState.value.paragraph.bullet.kind === 'autoNum'
      && textState.value.run.font === 'Aptos' && textState.value.run.size === 30
      && textState.direct.paragraph.includes('align')
      && textState.direct.paragraph.includes('bullet')
      && textState.direct.run.includes('font') && textState.direct.run.includes('size')
      && textChange.renderSlides.has(targetSlide)
      && textChange.renderSlides.has(inheritedSlide)
      && sourceSlides.every((id) => !textChange.renderSlides.has(id)));
  check('母版文字默认值重算直属版式的三级继承且不覆盖页面直接格式',
    beforeInherited[1].runs[0].fonts[0] !== 'Aptos'
      && inheritedParagraphs[1].align === 'right'
      && inheritedParagraphs[1].editInfo.bullet.kind === 'autoNum'
      && inheritedParagraphs[1].runs[0].fonts[0] === 'Aptos'
      && inheritedParagraphs[1].runs[0].size === 30
      && inheritedParagraphs[1].runs[0].color === 'rgb(66,99,235)'
      && inheritedParagraphs[1].runs[0].b === false
      && inheritedParagraphs[2].runs[0].b === true);
  const textOverride = doc.masters[targetMaster.id].ovr.textStyles.body[1];
  check('母版文字样式按字段保存协同覆盖而非固化整级有效值',
    Reflect.ownKeys(textOverride.paragraph).length === 2
      && Reflect.ownKeys(textOverride.run).length === 4);
  editor.undo();
  check('撤销母版文字样式恢复来源值',
    edit.queryMaster(doc, targetMaster.target).textStyles.body[1].direct.run.length === 0);
  editor.redo();
  check('重做母版文字样式恢复稀疏覆盖',
    edit.queryMaster(doc, targetMaster.target).textStyles.body[1].value.run.font === 'Aptos');
  const saved = await editor.saveDetailed();
  const reparsed = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const savedMaster = reparsed.editInfo.masters.find((master) => master.id === targetMaster.id);
  const savedSourceMaster = reparsed.editInfo.masters.find((master) => master.id === sourceMaster.id);
  const savedLevel = savedMaster.textStyles.body.paragraphs[1];
  check('母版背景、元素和文字默认值最小写回原母版 OPC part 并可重解析',
    solid(savedSourceMaster.background) === 'rgb(32,48,64)'
      && savedMaster.elements.some((element) => element.name === doc.elements[insertedId].src.name)
      && savedLevel.align === 'right'
      && savedLevel.editInfo.bullet.kind === 'autoNum'
      && savedLevel.runs[0].fonts[0] === 'Aptos'
      && savedLevel.runs[0].size === 30
      && savedLevel.runs[0].color === 'rgb(66,99,235)'
      && savedLevel.runs[0].b === false
      && new TextDecoder().decode(saved.package.parts[targetMaster.id]).includes('masterData')
      && new TextDecoder().decode(saved.package.parts[targetMaster.id]).includes('<p:hf sldNum="0"'));
  reparsed.dispose();
  check('母版文字样式拒绝越界层级和图片项目符号上传', (() => {
    try {
      editor.execDesign(targetMaster.target, {
        type: 'SetMasterTextStyle', target: targetMaster.target,
        category: 'body', level: 9, run: { size: 20 },
      });
      return false;
    } catch {
      try {
        editor.execDesign(targetMaster.target, {
          type: 'SetMasterTextStyle', target: targetMaster.target,
          category: 'body', level: 0,
          paragraph: { bullet: { kind: 'blip', image: { bytes: new Uint8Array([1]), mime: 'image/png' } } },
        });
        return false;
      } catch { return true; }
    }
  })());
  const minimalPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const minimalDoc = edit.createDoc(minimalPresentation, { idPrefix: 'master-minimal-' });
  const minimalEditor = new edit.Editor(minimalDoc);
  const minimalTarget = edit.listMasters(minimalDoc)[1].target;
  minimalEditor.execDesign(minimalTarget, {
    type: 'SetMasterTextStyle', target: minimalTarget,
    category: 'other', level: 8, run: { size: 17 },
  });
  const minimalSaved = await minimalEditor.saveDetailed();
  check('单字段母版编辑只重写一个母版 ZIP entry',
    minimalSaved.mode === 'passthrough' && minimalSaved.rewrittenEntries === 1);
  edit.disposeDoc(minimalDoc);

  const themePresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const themeDoc = edit.createDoc(themePresentation, { idPrefix: 'master-theme-' });
  const themeEditor = new edit.Editor(themeDoc);
  const themeMaster = edit.listMasters(themeDoc)[1];
  const themeMarker = themeDoc.masters[themeMaster.id].children
    .map((id) => themeDoc.elements[id]).find((element) => element.src.name === '目标母版标记');
  const beforeThemeState = edit.queryMaster(themeDoc, themeMaster.target);
  const beforeThemeTableStyles = JSON.stringify(edit.listTableStyles(themeDoc, themeMaster.target));
  themeEditor.exec({
    type: 'SetTheme', id: themeMaster.themeId,
    clrScheme: { accent1: '#C4D5E6', accent2: '#A1B2C3' },
    fontScheme: { minor: { latin: '母版主题字体' } },
  });
  const afterThemeState = edit.queryMaster(themeDoc, themeMaster.target);
  check('主题字段变化重新求值母版图形与九级文字而不伪造母版覆盖',
    solid(themeEditor.effectiveElement(themeMarker.id).fill) === 'rgb(161,178,195)'
      && beforeThemeState.textStyles.body[0].value.run.font !== '母版主题字体'
      && afterThemeState.textStyles.body[0].value.run.font === '母版主题字体'
      && afterThemeState.textStyles.body[0].source.run.font
        === beforeThemeState.textStyles.body[0].source.run.font
      && afterThemeState.textStyles.body[0].direct.run.length === 0);
  themeEditor.execDesign(themeMaster.target, {
    type: 'AddShape', target: themeMaster.target, preset: 'rect',
    rect: { x: 20, y: 20, w: 120, h: 60 },
  });
  const themedShapeId = themeEditor.selection.kind === 'elements'
    ? themeEditor.selection.ids[0] : null;
  themeEditor.execDesign(themeMaster.target, {
    type: 'AddTable', target: themeMaster.target, rows: 2, cols: 2,
    rect: { x: 20, y: 100, w: 240, h: 100 },
  });
  const themedTableId = themeEditor.selection.kind === 'elements'
    ? themeEditor.selection.ids[0] : null;
  const themedTable = themeEditor.effectiveElement(themedTableId);
  const afterThemeTableStyles = JSON.stringify(edit.listTableStyles(themeDoc, themeMaster.target));
  check('主题编辑后在母版新增形状、表格及表样式目录均使用重新求值的默认值',
    solid(themeEditor.effectiveElement(themedShapeId).fill) === 'rgb(196,213,230)'
      && themedTable.kind === 'table'
      && JSON.stringify(themedTable).includes('rgb(196,213,230)')
      && beforeThemeTableStyles !== afterThemeTableStyles
      && afterThemeTableStyles.includes('rgb(196,213,230)'));
  edit.disposeDoc(themeDoc);

  const recoveryPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const recoveryDoc = edit.createDoc(recoveryPresentation, { idPrefix: 'master-recovery-' });
  const recoveryEditor = new edit.Editor(recoveryDoc);
  const recoveryFrames = [];
  recoveryEditor.subscribeRecovery((frame) => recoveryFrames.push(frame));
  const recoveryTarget = edit.listMasters(recoveryDoc)[1].target;
  recoveryEditor.execDesign(recoveryTarget, {
    type: 'SetMasterTextStyle', target: recoveryTarget,
    category: 'other', level: 4, paragraph: { align: 'center' }, run: { size: 21 },
  });
  const replayPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const replayDoc = edit.createDoc(replayPresentation, { idPrefix: 'master-recovery-' });
  const replayEditor = new edit.Editor(replayDoc, {
    recoveryFrames: JSON.parse(JSON.stringify(recoveryFrames)),
  });
  check('母版字段补丁可序列化恢复到同一结构化查询与设计投影',
    JSON.stringify(edit.queryMaster(replayDoc, recoveryTarget))
      === JSON.stringify(edit.queryMaster(recoveryDoc, recoveryTarget))
      && JSON.stringify(replayEditor.toDesignCanvas(recoveryTarget))
        === JSON.stringify(recoveryEditor.toDesignCanvas(recoveryTarget)));
  edit.disposeDoc(replayDoc);
  edit.disposeDoc(recoveryDoc);
  edit.disposeDoc(doc);
}

const solid = (fill) => fill?.type === 'solid' ? fill.color : null;

const editors = new WeakMap();
function editorOf(edit, doc) {
  let editor = editors.get(doc);
  if (!editor) {
    editor = new edit.Editor(doc);
    editors.set(doc, editor);
  }
  return editor;
}
