const STYLE_ID = '{5F9D1B80-6B13-4A7A-AFC1-ADD7AB1E0001}';
const textOf = (body) => body?.paragraphs
  .map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n') ?? '';
const rejected = (fn) => { try { fn(); return false; } catch { return true; } };
const insertedId = (editor) => editor.selection.kind === 'elements' ? editor.selection.ids[0] : null;

/** 新表格只从发布命令、有效投影、历史和通用编辑能力取证。 */
export async function runAddTableContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ AddTable 模型、主题投影与历史\x1b[0m');
  const input = load('sample-editor-add-table.pptx');
  if (!check('找到确定性新增表格固件', !!input)) return;
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'add-table-' });
  const editor = new edit.Editor(doc);
  const slideId = doc.slideOrder[0];
  const slide = doc.slides[slideId];
  check('当前页与可新增页版式都保留同一主题表格默认值',
    slide.defaultTable?.styleId === STYLE_ID
      && presentation.editInfo.layouts[0].defaultTable?.styleId === STYLE_ID
      && slide.defaultTable.textBodyMarkup.startsWith('<a:txBody>')
      && slide.defaultTable.firstRow.editInfo?.textTemplate
      && slide.defaultTable.bandRows.every((cell) => cell.editInfo?.textTemplate));

  const result = editor.exec({
    type: 'AddTable', slideId, rows: 3, cols: 4,
    rect: { x: 123.25, y: 67.5, w: 701.125, h: 209.375 },
  });
  const id = insertedId(editor);
  const record = doc.elements[id];
  const table = editor.effectiveElement(id);
  const expectedFrame = {
    x: Math.round(123.25 * 9525) / 9525,
    y: Math.round(67.5 * 9525) / 9525,
    w: Math.round(701.125 * 9525) / 9525,
    h: Math.round(209.375 * 9525) / 9525,
  };
  check('单命令原子插入一个 graphicFrame 并自动选中新表格',
    result.forward.length === 1 && result.inverse.length === 1
      && result.forward[0].op === 'insert' && result.forward[0].path.length === 2
      && result.dirtySlides.size === 1 && result.dirtySlides.has(slideId)
      && result.dirtyElements.has(id) && editor.history.undoCount === 1
      && record?.meta.created && record.meta.editable === 'full'
      && record.meta.origin?.part === slide.origin.part
      && record.meta.insertion?.markup.includes('<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">')
      && record.meta.insertion.markup.includes(`<a:tableStyleId>${STYLE_ID}</a:tableStyleId>`));
  check('即时投影精确表达命令矩形、规则网格和空可编辑文字模板',
    table?.kind === 'table' && table.x === expectedFrame.x && table.y === expectedFrame.y
      && table.w === expectedFrame.w && table.h === expectedFrame.h
      && table.rows.length === 3 && table.colWidths.length === 4
      && table.rows.every((row) => row.cells.length === 4)
      && table.rows.every((row) => row.cells.every((cell) => cell.text === null
        && !!cell.editInfo?.textTemplate && textOf(cell.editInfo.textTemplate) === ''))
      && table.colWidths.reduce((sum, width) => sum + Math.round(width * 9525), 0)
        === Math.round(table.w * 9525)
      && table.rows.reduce((sum, row) => sum + Math.round(row.height * 9525), 0)
        === Math.round(table.h * 9525));
  check('首行与条纹行从当前主题求值而非硬编码颜色',
    table.rows[0].cells[0].fill?.type === 'solid'
      && table.rows[0].cells[0].fill.color === 'rgb(217,79,112)'
      && table.rows[0].cells[0].editInfo.textTemplate.paragraphs[0].runs[0].b === true
      && table.rows[1].cells[0].fill?.type === 'solid'
      && JSON.stringify(table.rows[1].cells[0].fill) !== JSON.stringify(table.rows[2].cells[0].fill)
      && table.rows.every((row) => row.cells.every((cell) => cell.borders?.l && cell.borders?.r)));
  check('创建时已携带末格 Tab 所需的追加行样式入口',
    table.editInfo?.tableRowAppend?.regular.length === 2
      && table.editInfo.tableRowAppend.last.length === 2);

  editor.exec({
    type: 'EditText', id, cell: { r: 0, c: 0 },
    ops: [{ type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 }, text: '标题' }],
  });
  editor.exec({ type: 'InsertRow', id });
  const edited = editor.effectiveElement(id);
  check('新表格无需保存重开即可逐格输入并复用既有追加行命令',
    textOf(edited.rows[0].cells[0].text) === '标题' && edited.rows.length === 4
      && edited.rows[3].cells.every((cell) => cell.text === null && !!cell.editInfo?.textTemplate));

  editor.exec({ type: 'SetXfrm', id, x: 140, y: 88, w: 680, h: 280, rot: 12 });
  const transformed = editor.effectiveElement(id);
  check('新表格直接复用通用移动、缩放、旋转和撤销链路',
    transformed.x === 140 && transformed.y === 88
      && transformed.w === 680 && transformed.h === 280 && transformed.rot === 12
      && transformed.colWidths.reduce((sum, width) => sum + width, 0) === transformed.w
      && transformed.rows.reduce((sum, row) => sum + row.height, 0) === transformed.h);
  editor.undo();
  editor.undo();
  editor.undo();
  editor.undo();
  check('四次撤销按变换、追加、文字、结构恢复到新增前状态',
    !doc.elements[id] && slide.children.every((childId) => childId !== id)
      && editor.selection.kind === 'none');
  editor.redo();
  check('重做结构恢复同一表格身份和自动选区', doc.elements[id]?.src.kind === 'table'
    && editor.selection.kind === 'elements' && editor.selection.ids[0] === id);

  editor.exec({ type: 'SetZ', id, to: 'back' });
  check('新表格复用通用层级命令并在撤销后恢复原顺序', slide.children[0] === id);
  editor.undo();
  check('表格层级撤销恢复新建时的尾部位置', slide.children[slide.children.length - 1] === id);
  editor.exec({ type: 'RemoveElement', id });
  check('新表格复用通用删除命令', !doc.elements[id] && !slide.children.includes(id));
  editor.undo();
  editor.redo();
  check('删除重做再次移除同一表格身份', !doc.elements[id] && !slide.children.includes(id));
  editor.undo();

  editor.exec({
    type: 'PasteElements', payload: edit.copyElements(doc, [id]),
    at: { parentId: slideId, x: 860, y: 250 },
  });
  const pastedId = insertedId(editor);
  const pasted = editor.effectiveElement(pastedId);
  check('新表格无需特判即可复制粘贴并保留主题网格与可编辑模板',
    pasted.kind === 'table' && pasted.rows.length === 3 && pasted.colWidths.length === 4
      && pasted.x === 860 && pasted.y === 250
      && pasted.rows[0].cells[0].fill?.color === 'rgb(217,79,112)'
      && pasted.rows[2].cells[3].editInfo?.textTemplate);
  editor.exec({ type: 'InsertRow', id: pastedId });
  const pastedWithRow = editor.effectiveElement(pastedId);
  check('粘贴后的表格继续保留主题追加行模板',
    pastedWithRow.kind === 'table' && pastedWithRow.rows.length === 4
      && JSON.stringify(pastedWithRow.rows[3].cells[0].fill)
        === JSON.stringify(table.editInfo.tableRowAppend.last[0].cells[0].fill));
  editor.undo();
  editor.undo();

  editor.exec({ type: 'InsertRow', id });
  editor.exec({
    type: 'PasteElements', payload: edit.copyElements(doc, [id]),
    at: { parentId: slideId, x: 860, y: 250 },
  });
  const pastedAfterAppendId = insertedId(editor);
  editor.exec({ type: 'InsertRow', id: pastedAfterAppendId });
  const pastedAfterTwoAppends = editor.effectiveElement(pastedAfterAppendId);
  check('已追加表格复制后再次追加会从当前行数继续交替条纹',
    pastedAfterTwoAppends.kind === 'table' && pastedAfterTwoAppends.rows.length === 5
      && JSON.stringify(pastedAfterTwoAppends.rows[3].cells[0].fill)
        === JSON.stringify(table.editInfo.tableRowAppend.last[0].cells[0].fill)
      && JSON.stringify(pastedAfterTwoAppends.rows[4].cells[0].fill)
        === JSON.stringify(table.editInfo.tableRowAppend.last[1].cells[0].fill));
  editor.undo();
  editor.undo();
  editor.undo();

  const malformedTable = structuredClone(edit.copyElements(doc, [id]));
  malformedTable.records[malformedTable.roots[0]].src.editInfo.tableRowAppend.regular[0].height = Number.NaN;
  const identityBeforeMalformedPaste = JSON.stringify(doc.identity);
  const childrenBeforeMalformedPaste = [...slide.children];
  const historyBeforeMalformedPaste = editor.history.undoCount;
  check('篡改的追加行模板在分配身份和提交历史前原子拒绝', rejected(() => editor.exec({
    type: 'PasteElements', payload: malformedTable,
    at: { parentId: slideId, x: 860, y: 250 },
  })) && JSON.stringify(doc.identity) === identityBeforeMalformedPaste
    && JSON.stringify(slide.children) === JSON.stringify(childrenBeforeMalformedPaste)
    && editor.history.undoCount === historyBeforeMalformedPaste);

  const emptyPlaceholder = Object.values(doc.elements).find((candidate) =>
    candidate.meta.ph?.type === 'obj' && candidate.src.kind === 'shape' && candidate.src.text === null);
  const nonemptyPlaceholder = Object.values(doc.elements).find((candidate) =>
    candidate.meta.ph?.type === 'obj' && candidate.src.kind === 'shape' && candidate.src.text !== null);
  const emptyRect = {
    x: emptyPlaceholder.src.x, y: emptyPlaceholder.src.y,
    w: emptyPlaceholder.src.w, h: emptyPlaceholder.src.h,
  };
  const emptyOrder = edit.elementOrder(emptyPlaceholder);
  editor.exec({
    type: 'AddTable', slideId, rows: 2, cols: 3, rect: emptyRect,
    placeholderId: emptyPlaceholder.id,
  });
  const placeholderTableId = insertedId(editor);
  check('空内容占位符在一个历史单元中原位替换为表格',
    !doc.elements[emptyPlaceholder.id] && doc.elements[placeholderTableId]?.src.kind === 'table'
      && editor.effectiveElement(placeholderTableId).x === emptyRect.x
      && edit.elementOrder(doc.elements[placeholderTableId]) === emptyOrder
      && result.dirtySlides.size === 1 && editor.history.undoCount === 2);
  editor.undo();
  check('占位符替换撤销会同时移除表格并恢复原占位符与选区',
    !doc.elements[placeholderTableId] && doc.elements[emptyPlaceholder.id]?.src.kind === 'shape'
      && editor.selection.kind === 'elements' && editor.selection.ids[0] === id);

  const beforeFailure = {
    identity: JSON.stringify(doc.identity), children: slide.children.join(','),
    selection: JSON.stringify(editor.selection), history: editor.history.undoCount,
  };
  check('拒绝非法行列、矩形、页面、非空/跨页占位符和命令额外字段',
    rejected(() => editor.exec({ type: 'AddTable', slideId, rows: 0, cols: 1, rect: emptyRect }))
      && rejected(() => editor.exec({ type: 'AddTable', slideId, rows: 1.5, cols: 1, rect: emptyRect }))
      && rejected(() => editor.exec({ type: 'AddTable', slideId, rows: 76, cols: 1, rect: emptyRect }))
      && rejected(() => editor.exec({ type: 'AddTable', slideId, rows: 1, cols: 76, rect: emptyRect }))
      && rejected(() => editor.exec({ type: 'AddTable', slideId, rows: 1, cols: 1, rect: { ...emptyRect, w: 0 } }))
      && rejected(() => editor.exec({ type: 'AddTable', slideId: 'missing', rows: 1, cols: 1, rect: emptyRect }))
      && rejected(() => editor.exec({ type: 'AddTable', slideId, rows: 1, cols: 1, rect: emptyRect, placeholderId: nonemptyPlaceholder.id }))
      && rejected(() => editor.exec({ type: 'AddTable', slideId, rows: 1, cols: 1, rect: emptyRect, extra: true })));
  check('全部拒绝路径不消费身份、不改结构、选区和历史',
    JSON.stringify(doc.identity) === beforeFailure.identity
      && slide.children.join(',') === beforeFailure.children
      && JSON.stringify(editor.selection) === beforeFailure.selection
      && editor.history.undoCount === beforeFailure.history);

  const createdSlide = [...editor.exec({
    type: 'AddSlide', layoutId: doc.layoutOrder[0], at: { after: slideId },
  }).createdSlides][0];
  check('跨页内容占位符被整笔拒绝', rejected(() => editor.exec({
    type: 'AddTable', slideId: createdSlide, rows: 2, cols: 2,
    rect: { x: 100, y: 100, w: 400, h: 240 }, placeholderId: emptyPlaceholder.id,
  })));
  editor.exec({
    type: 'AddTable', slideId: createdSlide, rows: 2, cols: 2,
    rect: { x: 100, y: 100, w: 400, h: 240 },
  });
  const newSlideTable = insertedId(editor);
  check('会话中新页继承版式主题默认值并可直接插入表格',
    doc.elements[newSlideTable]?.parent === createdSlide
      && editor.effectiveElement(newSlideTable).kind === 'table'
      && editor.effectiveElement(newSlideTable).rows[0].cells[0].fill?.color === 'rgb(217,79,112)');
  editor.undo();
  editor.undo();

  const stressStart = performance.now();
  editor.exec({
    type: 'AddTable', slideId, rows: 75, cols: 75,
    rect: { x: 10, y: 10, w: 1200, h: 680 },
  });
  const stressId = insertedId(editor);
  const stressMs = performance.now() - stressStart;
  const stress = editor.effectiveElement(stressId);
  check('75×75 格式上限仍可创建、撤销且保持纯数据',
    stress.kind === 'table' && stress.rows.length === 75 && stress.rows[0].cells.length === 75
      && (() => { try { structuredClone(doc.elements[stressId]); return true; } catch { return false; } })());
  editor.undo();
  console.log(`  AddTable 75×75 模型提交 ${stressMs.toFixed(2)}ms`);

  const builtinPresentation = await core.parse(load('sample-editor-add-table-builtin.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const builtinDoc = edit.createDoc(builtinPresentation, { idPrefix: 'add-table-builtin-' });
  const builtinEditor = new edit.Editor(builtinDoc);
  const builtinSlideId = builtinDoc.slideOrder[0];
  builtinEditor.exec({
    type: 'AddTable', slideId: builtinSlideId, rows: 3, cols: 3,
    rect: { x: 180, y: 140, w: 720, h: 300 },
  });
  const builtinId = insertedId(builtinEditor);
  const builtin = builtinEditor.effectiveElement(builtinId);
  check('仅含默认 GUID 的常见 PowerPoint 内置表样式仍保留 ID 并按当前主题即时求值',
    builtinDoc.slides[builtinSlideId].defaultTable?.styleId
      === '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}'
      && builtin.kind === 'table'
      && builtin.rows[0].cells[0].fill?.color === 'rgb(217,79,112)'
      && builtin.rows[0].cells[0].editInfo?.textTemplate.paragraphs[0].runs[0].b === true
      && JSON.stringify(builtin.rows[1].cells[0].fill) !== JSON.stringify(builtin.rows[2].cells[0].fill)
      && builtinDoc.elements[builtinId].meta.insertion.markup
        .includes('<a:tableStyleId>{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}</a:tableStyleId>'));
  edit.disposeDoc(builtinDoc);

  const readonlyPresentation = await core.parse(input, { edit: true, lazy: false, assets: 'defer' });
  const readonlyDoc = edit.createDoc(readonlyPresentation, { idPrefix: 'add-table-readonly-' });
  const readonlyEditor = new edit.Editor(readonlyDoc);
  check('缺少可写 OOXML 包时拒绝新增表格', rejected(() => readonlyEditor.exec({
    type: 'AddTable', slideId: readonlyDoc.slideOrder[0], rows: 2, cols: 2,
    rect: { x: 10, y: 10, w: 100, h: 100 },
  })));
  edit.disposeDoc(readonlyDoc);
  edit.disposeDoc(doc);
}
