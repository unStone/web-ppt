const cellText = (table, r, c) => table.rows[r].cells[c].text?.paragraphs
  .map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n') ?? '';

/** 只从发布命令、有效表格投影、选区和保存重开观察单元格文字编辑。 */
export async function runTableCellTextContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 表格单元格文字编辑\x1b[0m');
  const presentation = await core.parse(load('sample-edit-basic.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'table-cell-text-' });
  const editor = new edit.Editor(doc);
  const record = Object.values(doc.elements).find((candidate) => candidate.src.kind === 'table');
  if (!check('基础编辑固件含两个可写表格单元格', !!record
    && cellText(record.src, 0, 0) === 'A' && cellText(record.src, 0, 1) === 'B')) return;

  const readonlyRange = {
    from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 1 },
  };
  record.meta.editable = 'frame';
  let readonlyRejected = 0;
  try { edit.queryRunProps(doc, record.id, readonlyRange, { r: 0, c: 0 }); } catch { readonlyRejected++; }
  try { edit.queryParaProps(doc, record.id, readonlyRange, { r: 0, c: 0 }); } catch { readonlyRejected++; }
  try {
    editor.select({
      kind: 'text', id: record.id, cell: { r: 0, c: 0 },
      anchor: readonlyRange.from, focus: readonlyRange.to,
    });
  } catch { readonlyRejected++; }
  record.meta.editable = 'full';
  editor.select({ kind: 'none' });
  check('只读表格不能进入文字选区或格式查询 seam', readonlyRejected === 3);

  const source = JSON.stringify(record.src);
  const cell = { r: 0, c: 0 };
  const result = editor.transaction((transaction) => {
    transaction.exec({
      type: 'EditText', id: record.id, cell,
      ops: [{
        type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 1 }, text: '纯Web',
      }],
    });
    transaction.select({
      kind: 'text', id: record.id, cell,
      anchor: { p: 0, r: 0, off: 4 }, focus: { p: 0, r: 0, off: 4 },
    });
  }, '编辑表格文字');
  const effective = editor.effectiveElement(record.id);
  check('EditText 用显式 cell 地址稀疏修改目标格且不伪造元素身份',
    effective.kind === 'table' && cellText(effective, 0, 0) === '纯Web'
      && cellText(effective, 0, 1) === 'B' && JSON.stringify(record.src) === source
      && result.forward.length === 1 && result.dirtyElements.has(record.id)
      && result.forward[0].path.join('/')
        === `elements/${record.id}/ovr/tableCells/0/0/text`
      && Object.keys(doc.elements).every((id) => !id.includes(':0:0'))
      && editor.selection.kind === 'text' && editor.selection.cell?.r === 0
      && editor.selection.cell?.c === 0);

  const range = {
    from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 4 },
  };
  editor.exec({ type: 'SetRunProps', id: record.id, cell, range, props: { b: true } });
  editor.exec({ type: 'SetParaProps', id: record.id, cell, range, props: { align: 'center' } });
  const formatted = editor.effectiveElement(record.id);
  const state = edit.queryRunProps(doc, record.id, range, cell);
  const paragraph = formatted.rows[0].cells[0].text.paragraphs[0];
  check('字符与段落格式复用同一单元格文字目标和三态查询',
    state.b.value === true && !state.b.mixed
      && paragraph.align === 'center' && paragraph.runs.every((run) => run.b)
      && formatted.rows[0].cells[1] === record.src.rows[0].cells[1],
  `state=${JSON.stringify(state.b)} align=${paragraph.align}`
    + ` bold=${paragraph.runs.map((run) => run.b).join('/')} siblingIdentity=`
    + `${formatted.rows[0].cells[1] === record.src.rows[0].cells[1]}`);

  let rejected = 0;
  for (const badCell of [{ r: -1, c: 0 }, { r: 0, c: 2 }, { r: 0.5, c: 0 }]) {
    try {
      editor.exec({
        type: 'EditText', id: record.id, cell: badCell,
        ops: [{ type: 'replace', from: range.from, to: range.from, text: 'x' }],
      });
    } catch { rejected++; }
  }
  check('非法单元格地址在 patch 前原子拒绝', rejected === 3
    && cellText(editor.effectiveElement(record.id), 0, 0) === '纯Web');

  editor.undo();
  editor.undo();
  editor.undo();
  check('撤销三类文字事务恢复来源表格且清掉稀疏覆盖',
    cellText(editor.effectiveElement(record.id), 0, 0) === 'A'
      && record.ovr.tableCells === undefined && !editor.isDirty());
  editor.redo();
  editor.redo();
  editor.redo();

  const saved = await editor.saveDetailed();
  const reopened = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedTable = reopened.slides[0].elements.find((element) => element.name === record.src.name);
  check('单元格文字保存只改目标 slide part，重开保留内容、格式与未编辑格',
    saved.rewrittenEntries === 1 && reopenedTable?.kind === 'table'
      && cellText(reopenedTable, 0, 0) === '纯Web' && cellText(reopenedTable, 0, 1) === 'B'
      && reopenedTable.rows[0].cells[0].text.paragraphs[0].align === 'center'
      && reopenedTable.rows[0].cells[0].text.paragraphs[0].runs.every((run) => run.b));
  edit.disposeDoc(doc);

  const advancedPresentation = await core.parse(load('sample-editor-table-text.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const advancedDoc = edit.createDoc(advancedPresentation, { idPrefix: 'table-cell-advanced-' });
  const advancedEditor = new edit.Editor(advancedDoc);
  const table = Object.values(advancedDoc.elements)
    .find((candidate) => candidate.src.name === '表格文字综合');
  check('确定性表格固件保留空格格式入口、合并、RTL、竖排和裸 autofit',
    table?.src.kind === 'table'
      && table.src.flipH && table.src.flipV
      && table.src.rows[0].cells[1].text === null
      && !!table.src.rows[0].cells[1].editInfo?.textTemplate
      && table.src.rows[0].cells[2].colSpan === 2 && table.src.rows[0].cells[3].merged
      && table.src.rows[1].cells[0].rowSpan === 2 && table.src.rows[2].cells[0].merged
      && table.src.rows[1].cells[1].vert === 'vert'
      && table.src.rows[1].cells[2].text.paragraphs[0].rtl
      && table.src.rows[1].cells[3].text.autoFitCompute);
  let mergedRejected = 0;
  for (const merged of [{ r: 0, c: 3 }, { r: 2, c: 0 }]) {
    try {
      advancedEditor.exec({
        type: 'EditText', id: table.id, cell: merged,
        ops: [{
          type: 'replace', from: { p: 0, r: 0, off: 0 },
          to: { p: 0, r: 0, off: 0 }, text: '禁止',
        }],
      });
    } catch { mergedRejected++; }
  }
  check('横纵合并占位格不能被单独写入或污染历史',
    mergedRejected === 2 && advancedEditor.history.undoCount === 0 && !advancedEditor.isDirty());
  let mergedSelectionRejected = false;
  try {
    advancedEditor.select({
      kind: 'text', id: table.id, cell: { r: 0, c: 3 },
      anchor: { p: 0, r: 0, off: 0 }, focus: { p: 0, r: 0, off: 0 },
    });
  } catch { mergedSelectionRejected = true; }
  check('文本选区与文字命令共用合并占位格边界', mergedSelectionRejected);
  advancedEditor.exec({
    type: 'EditText', id: table.id, cell: { r: 0, c: 1 },
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 },
      to: { p: 0, r: 0, off: 0 }, text: '空格可写',
    }],
  });
  const filled = advancedEditor.effectiveElement(table.id).rows[0].cells[1];
  check('空单元格从 endParaRPr 继承格式后进入标准 TableElement 投影',
    cellText(advancedEditor.effectiveElement(table.id), 0, 1) === '空格可写'
      && filled.text.paragraphs[0].runs[0].b
      && table.src.rows[0].cells[1].text === null);
  edit.disposeDoc(advancedDoc);
}
