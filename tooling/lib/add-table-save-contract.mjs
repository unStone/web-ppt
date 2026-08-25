import { diffPackageBytes } from '../diff-package.mjs';

const textOf = (body) => body?.paragraphs
  .map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n') ?? '';

function insertScenario(editor, doc, scenario) {
  const slideId = doc.slideOrder[scenario.slideIndex];
  const placeholder = Object.values(doc.elements).find((record) =>
    record.src.name === scenario.placeholderName);
  editor.exec({
    type: 'AddTable', slideId, rows: scenario.rows, cols: scenario.cols, rect: scenario.rect,
    placeholderId: placeholder.id,
  });
  const id = editor.selection.kind === 'elements' ? editor.selection.ids[0] : null;
  for (const change of scenario.edits) editor.exec({
    type: 'EditText', id, cell: change.cell,
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 }, text: change.text,
    }],
  });
  editor.exec({ type: 'InsertRow', id });
  editor.exec({
    type: 'EditText', id, cell: { r: scenario.rows, c: scenario.cols - 1 },
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 },
      text: scenario.appendedText,
    }],
  });
  if (scenario.transform) editor.exec({ type: 'SetXfrm', id, ...scenario.transform });
  return id;
}

/** 新表格保存只从公开命令、包差异、重开和独立进程渲染取证。 */
export async function runAddTableSaveContract({
  core, edit, load, check, eq, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ AddTable 保留型保存与重开\x1b[0m');
  const scenario = Object.freeze({
    type: 'addTable', file: 'sample-editor-add-table.pptx', slideIndex: 0,
    placeholderName: '空内容占位符', rows: 2, cols: 3,
    rect: { x: 90, y: 92, w: 720, h: 410 },
    edits: [
      { cell: { r: 0, c: 0 }, text: '主题表头' },
      { cell: { r: 1, c: 1 }, text: '正文单元格' },
    ],
    appendedText: 'Tab 新行',
    transform: { x: 100, y: 80, w: 684, h: 450 },
  });
  const input = load(scenario.file);
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'add-table-save-' });
  const editor = new edit.Editor(doc);
  const id = insertScenario(editor, doc, scenario);
  const projected = editor.effectiveElement(id);
  const name = doc.elements[id].src.name;
  const saved = await editor.saveDetailed();
  const artifact = saveArtifact('add-table.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  const xml = new TextDecoder().decode(saved.package.parts['ppt/slides/slide1.xml']);
  const addedAt = xml.indexOf(`name="${name}"`);
  const extensionAt = xml.indexOf('{ADD-TABLE-TAIL}');
  const host = xml.slice(xml.lastIndexOf('<p:graphicFrame>', addedAt),
    xml.indexOf('</p:graphicFrame>', addedAt) + '</p:graphicFrame>'.length);
  check('占位符替换与新表格只重写目标 slide part，并保留未知尾节点原位',
    saved.mode === 'passthrough' && saved.rewrittenEntries === 1
      && diff.added.length === 0 && diff.removed.length === 0
      && diff.changed.join(',') === 'ppt/slides/slide1.xml'
      && !xml.includes('name="空内容占位符"') && xml.includes('name="非空内容占位符"')
      && addedAt > 0 && extensionAt > addedAt && xml.indexOf('<fixture:keep', extensionAt) > extensionAt);
  check('写回宿主遵守 graphicFrame/a:tbl sequence、主题样式和整数 EMU 网格',
    host.startsWith('<p:graphicFrame>')
      && host.indexOf('<p:nvGraphicFramePr>') < host.indexOf('<p:xfrm')
      && host.indexOf('<p:xfrm') < host.indexOf('<a:graphic>')
      && host.includes('<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">')
      && host.includes('<a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{5F9D1B80-6B13-4A7A-AFC1-ADD7AB1E0001}</a:tableStyleId></a:tblPr>')
      && [...host.matchAll(/<a:gridCol w="(\d+)"\/>/g)].map((match) => Number(match[1]))
        .reduce((sum, value) => sum + value, 0) === 684 * 9525
      && [...host.matchAll(/<a:tr h="(\d+)">/g)].map((match) => Number(match[1]))
        .reduce((sum, value) => sum + value, 0) === 450 * 9525
      && host.includes('主题表头') && host.includes('正文单元格') && host.includes('Tab 新行'));

  const reopened = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const table = reopened.slides[scenario.slideIndex].elements.find((element) =>
    element.kind === 'table' && element.name === name);
  check('保存重开恢复同一 frame、规则网格、主题视觉和三处文字',
    table?.kind === 'table' && table.x === projected.x && table.y === projected.y
      && table.w === projected.w && table.h === projected.h
      && table.rows.length === 3 && table.colWidths.length === 3
      && textOf(table.rows[0].cells[0].text) === '主题表头'
      && textOf(table.rows[1].cells[1].text) === '正文单元格'
      && textOf(table.rows[2].cells[2].text) === 'Tab 新行'
      && JSON.stringify(table.rows[0].cells[0].fill) === JSON.stringify(projected.rows[0].cells[0].fill)
      && JSON.stringify(table.rows[1].cells[0].fill) === JSON.stringify(projected.rows[1].cells[0].fill)
      && table.editInfo?.tableRowAppend);
  check('保存重开前后 frame 与全部行列的整数 EMU 总和严格相等',
    projected.colWidths.reduce((sum, width) => sum + Math.round(width * 9525), 0)
      === Math.round(projected.w * 9525)
      && projected.rows.reduce((sum, row) => sum + Math.round(row.height * 9525), 0)
        === Math.round(projected.h * 9525)
      && table.colWidths.reduce((sum, width) => sum + Math.round(width * 9525), 0)
        === Math.round(table.w * 9525)
      && table.rows.reduce((sum, row) => sum + Math.round(row.height * 9525), 0)
        === Math.round(table.h * 9525));

  const projectedFingerprint = renderFingerprint(scenario.file, 'projected', scenario);
  const savedFingerprint = renderFingerprint(artifact, 'saved', scenario);
  for (const mode of ['html', 'svg']) {
    eq(`新增表格保存产物 ${mode} 指纹等于独立进程有效投影`,
      savedFingerprint[mode], projectedFingerprint[mode]);
  }

  const savedAgain = await editor.saveDetailed();
  const secondXml = new TextDecoder().decode(savedAgain.package.parts['ppt/slides/slide1.xml']);
  check('连续保存从基线重建，不重复插入表格或复活占位符',
    [...secondXml.matchAll(new RegExp(`name="${name}"`, 'g'))].length === 1
      && !secondXml.includes('name="空内容占位符"'));

  for (let index = 0; index < 6; index++) editor.undo();
  const restored = await editor.saveDetailed();
  const restoredDiff = diffPackageBytes(input, restored.bytes);
  check('保存后依次撤销变换、新行、三处文字与结构可回到原始包',
    restoredDiff.changed.length === 0 && restoredDiff.added.length === 0
      && restoredDiff.removed.length === 0);
  for (let index = 0; index < 6; index++) editor.redo();
  const redone = await editor.saveDetailed();
  check('保存后全量撤销再重做恢复逐字节相同的原生表格产物',
    diffPackageBytes(saved.bytes, redone.bytes).equal);

  const clipboardPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const clipboardDoc = edit.createDoc(clipboardPresentation, { idPrefix: 'add-table-clipboard-' });
  const clipboardEditor = new edit.Editor(clipboardDoc);
  const clipboardSlideId = clipboardDoc.slideOrder[0];
  const noFillDefaults = structuredClone(clipboardDoc.slides[clipboardSlideId].defaultTable);
  noFillDefaults.bandRows[1] = { ...noFillDefaults.bandRows[1], fill: null };
  clipboardDoc.slides[clipboardSlideId].defaultTable = noFillDefaults;
  clipboardEditor.exec({
    type: 'AddTable', slideId: clipboardSlideId, rows: 3, cols: 3,
    rect: { x: 100, y: 90, w: 480, h: 240 },
  });
  const clipboardSourceId = clipboardEditor.selection.ids[0];
  check('已求值无填充被写成显式 noFill 而非继续依赖来源表样式',
    clipboardDoc.elements[clipboardSourceId].meta.insertion.markup.includes('<a:noFill/>'));
  clipboardEditor.exec({ type: 'InsertRow', id: clipboardSourceId });
  const clipboardTargetPresentation = await core.parse(load('sample-editor-add-shape.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const clipboardTargetDoc = edit.createDoc(clipboardTargetPresentation, {
    idPrefix: 'add-table-clipboard-target-',
  });
  const clipboardTargetEditor = new edit.Editor(clipboardTargetDoc);
  const clipboardTargetSlideId = clipboardTargetDoc.slideOrder[0];
  clipboardTargetEditor.exec({
    type: 'PasteElements', payload: edit.copyElements(clipboardDoc, [clipboardSourceId]),
    at: { parentId: clipboardTargetSlideId, x: 650, y: 250 },
  });
  const clipboardPastedId = clipboardTargetEditor.selection.ids[0];
  clipboardTargetEditor.exec({ type: 'InsertRow', id: clipboardPastedId });
  clipboardTargetEditor.exec({
    type: 'EditText', id: clipboardPastedId, cell: { r: 4, c: 2 },
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 },
      text: '粘贴后新增行',
    }],
  });
  const clipboardProjected = clipboardTargetEditor.effectiveElement(clipboardPastedId);
  const clipboardName = clipboardTargetDoc.elements[clipboardPastedId].src.name;
  const clipboardSaved = await clipboardTargetEditor.saveDetailed();
  const clipboardReopened = await core.parse(clipboardSaved.bytes, { lazy: false, assets: 'defer' });
  const clipboardTable = clipboardReopened.slides[0].elements.find((element) =>
    element.kind === 'table' && element.name === clipboardName
      && element.x === clipboardProjected.x && element.rows.length === 5);
  const comparableFill = (fill) => !fill || fill.type === 'none' ? 'none' : JSON.stringify(fill);
  check('已追加表格跨文档复制后再追加的即时主题视觉与保存重开结果一致',
    clipboardTargetDoc.slides[clipboardTargetSlideId].defaultTable?.styleId === undefined
      && clipboardProjected.kind === 'table' && clipboardProjected.rows.length === 5
      && clipboardTable?.kind === 'table' && clipboardTable.rows.length === 5
      && clipboardTable.rows.every((row, rowIndex) =>
        comparableFill(row.cells[0].fill)
          === comparableFill(clipboardProjected.rows[rowIndex].cells[0].fill))
      && textOf(clipboardTable.rows[4].cells[2].text) === '粘贴后新增行',
  JSON.stringify({
    projected: clipboardProjected.kind === 'table'
      ? clipboardProjected.rows.map((row) => row.cells[0].fill) : null,
    reopened: clipboardTable?.kind === 'table'
      ? clipboardTable.rows.map((row) => row.cells[0].fill) : null,
  }));
  clipboardReopened.dispose?.();
  edit.disposeDoc(clipboardTargetDoc);
  edit.disposeDoc(clipboardDoc);

  const fallbackInput = load('sample-editor-add-shape.pptx');
  const fallbackPresentation = await core.parse(fallbackInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const fallbackDoc = edit.createDoc(fallbackPresentation, { idPrefix: 'add-table-fallback-' });
  const fallbackEditor = new edit.Editor(fallbackDoc);
  const fallbackSlideId = fallbackDoc.slideOrder[0];
  fallbackEditor.exec({
    type: 'AddTable', slideId: fallbackSlideId, rows: 2, cols: 3,
    rect: { x: 180, y: 140, w: 720, h: 300 },
  });
  const fallbackId = fallbackEditor.selection.ids[0];
  const fallbackProjected = fallbackEditor.effectiveElement(fallbackId);
  const fallbackSaved = await fallbackEditor.saveDetailed();
  saveArtifact('add-table-fallback.pptx', fallbackSaved.bytes);
  const fallbackXml = new TextDecoder().decode(fallbackSaved.package.parts['ppt/slides/slide1.xml']);
  const fallbackReopened = await core.parse(fallbackSaved.bytes, { lazy: false, assets: 'defer' });
  const fallbackTable = fallbackReopened.slides[0].elements.find((element) =>
    element.kind === 'table' && element.name === fallbackDoc.elements[fallbackId].src.name);
  check('缺少 tableStyles.xml 时即时投影与写回共享主题中性内部网格',
    fallbackDoc.slides[fallbackSlideId].defaultTable?.styleId === undefined
      && fallbackProjected.kind === 'table'
      && fallbackProjected.rows.every((row) => row.cells.every((cell) =>
        cell.borders?.l && cell.borders.r && cell.borders.t && cell.borders.b))
      && !fallbackXml.includes('<a:tableStyleId>')
      && [...fallbackXml.matchAll(/<a:ln[LRBT] w="9525">/g)].length === 24
      && fallbackTable?.kind === 'table'
      && fallbackTable.rows.every((row) => row.cells.every((cell) =>
        cell.borders?.l && cell.borders.r && cell.borders.t && cell.borders.b)));

  const builtinInput = load('sample-editor-add-table-builtin.pptx');
  const builtinPresentation = await core.parse(builtinInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const builtinDoc = edit.createDoc(builtinPresentation, { idPrefix: 'add-table-builtin-save-' });
  const builtinEditor = new edit.Editor(builtinDoc);
  builtinEditor.exec({
    type: 'AddTable', slideId: builtinDoc.slideOrder[0], rows: 3, cols: 3,
    rect: { x: 180, y: 140, w: 720, h: 300 },
  });
  const builtinName = builtinDoc.elements[builtinEditor.selection.ids[0]].src.name;
  const builtinSaved = await builtinEditor.saveDetailed();
  saveArtifact('add-table-builtin.pptx', builtinSaved.bytes);
  const builtinXml = new TextDecoder().decode(builtinSaved.package.parts['ppt/slides/slide1.xml']);
  const builtinReopened = await core.parse(builtinSaved.bytes, { lazy: false, assets: 'defer' });
  const builtinTable = builtinReopened.slides[0].elements.find((element) =>
    element.kind === 'table' && element.name === builtinName);
  check('built-in-only 默认表样式保存时保留 GUID，重开保持当前主题首行与条纹视觉',
    builtinXml.includes('<a:tableStyleId>{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}</a:tableStyleId>')
      && builtinTable?.kind === 'table'
      && builtinTable.rows[0].cells[0].fill?.color === 'rgb(217,79,112)'
      && JSON.stringify(builtinTable.rows[1].cells[0].fill)
        !== JSON.stringify(builtinTable.rows[2].cells[0].fill));

  const stressPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const stressDoc = edit.createDoc(stressPresentation, { idPrefix: 'add-table-stress-' });
  const stressEditor = new edit.Editor(stressDoc);
  const stressSlideId = stressDoc.slideOrder[0];
  const createStarted = performance.now();
  stressEditor.exec({
    type: 'AddTable', slideId: stressSlideId, rows: 75, cols: 75,
    rect: { x: 10, y: 10, w: 1200, h: 675 },
  });
  const createMs = performance.now() - createStarted;
  const stressName = stressDoc.elements[stressEditor.selection.ids[0]].src.name;
  const saveStarted = performance.now();
  const stressSaved = await stressEditor.saveDetailed();
  const saveMs = performance.now() - saveStarted;
  const stressXml = new TextDecoder().decode(stressSaved.package.parts['ppt/slides/slide1.xml']);
  const stressReopened = await core.parse(stressSaved.bytes, { lazy: false, assets: 'defer' });
  const stressTable = stressReopened.slides[0].elements.find((element) =>
    element.kind === 'table' && element.name === stressName);
  check('75×75 格式上限可保存并重开全部 5625 个可编辑单元格',
    [...stressXml.matchAll(/<a:gridCol w="\d+"\/>/g)].length === 75
      && [...stressXml.matchAll(/<a:tr h="\d+">/g)].length === 75
      && [...stressXml.matchAll(/<a:tc>/g)].length === 5625
      && stressTable?.kind === 'table' && stressTable.rows.length === 75
      && stressTable.rows.every((row) => row.cells.length === 75));
  console.log(`  AddTable 75×75 模型提交/保存 ${createMs.toFixed(2)}/${saveMs.toFixed(2)}ms`);

  const newPagePresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const newPageDoc = edit.createDoc(newPagePresentation, { idPrefix: 'add-table-new-slide-' });
  const newPageEditor = new edit.Editor(newPageDoc);
  const createdSlide = [...newPageEditor.exec({
    type: 'AddSlide', layoutId: newPageDoc.layoutOrder[0],
    at: { after: newPageDoc.slideOrder[0] },
  }).createdSlides][0];
  newPageEditor.exec({
    type: 'AddTable', slideId: createdSlide, rows: 2, cols: 2,
    rect: { x: 220, y: 160, w: 840, h: 360 },
  });
  const createdTableId = newPageEditor.selection.ids[0];
  newPageEditor.exec({
    type: 'EditText', id: createdTableId, cell: { r: 0, c: 0 },
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 },
      to: { p: 0, r: 0, off: 0 }, text: '新增页表格',
    }],
  });
  const newPageSaved = await newPageEditor.saveDetailed();
  saveArtifact('add-table-new-slide.pptx', newPageSaved.bytes);
  const newPageDiff = diffPackageBytes(input, newPageSaved.bytes);
  const newPageXml = new TextDecoder().decode(newPageSaved.package.parts['ppt/slides/slide2.xml']);
  const newPageReopened = await core.parse(newPageSaved.bytes, { lazy: false, assets: 'defer' });
  const reopenedNewTable = newPageReopened.slides[1].elements.find((element) =>
    element.kind === 'table');
  check('新增页与原生表格一次保存只创建该页骨架，且重开恢复主题和文字',
    newPageDiff.added.join(',') === 'ppt/slides/_rels/slide2.xml.rels,ppt/slides/slide2.xml'
      && newPageDiff.removed.length === 0
      && newPageDiff.changed.join(',') === '[Content_Types].xml,ppt/_rels/presentation.xml.rels,ppt/presentation.xml'
      && newPageXml.includes('<a:tbl>') && newPageXml.includes('新增页表格')
      && reopenedNewTable?.kind === 'table' && reopenedNewTable.rows.length === 2
      && textOf(reopenedNewTable.rows[0].cells[0].text) === '新增页表格'
      && reopenedNewTable.rows[0].cells[0].fill?.color === 'rgb(217,79,112)');
  newPageReopened.dispose?.();
  stressReopened.dispose?.();
  edit.disposeDoc(stressDoc);
  builtinReopened.dispose?.();
  edit.disposeDoc(builtinDoc);
  fallbackReopened.dispose?.();
  edit.disposeDoc(fallbackDoc);
  edit.disposeDoc(newPageDoc);
  reopened.dispose?.();
  edit.disposeDoc(doc);
}
