const plain = (cell) => cell.text?.paragraphs.map((paragraph) =>
  paragraph.runs.map((run) => run.text).join('')).join('\n') ?? '';

/** 稳定行列身份是结构编辑与现有数字坐标文本编辑之间的公开接缝。 */
export async function runTableStructureContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 表格稳定网格结构\x1b[0m');
  const presentation = await core.parse(load('sample-edit-basic.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'table-structure-' });
  const editor = new edit.Editor(doc);
  const record = Object.values(doc.elements).find((candidate) => candidate.src.kind === 'table');
  const before = edit.queryTableGrid(doc, record.id);
  const target = before.rows[0];
  editor.exec({
    type: 'EditText', id: record.id, cell: { r: 0, c: 0 },
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 },
      to: { p: 0, r: 0, off: 0 }, text: '稳定逻辑格',
    }],
  });
  editor.exec({ type: 'InsertRow', id: record.id, at: { before: target.id } });
  const after = edit.queryTableGrid(doc, record.id);
  const targetIndex = after.rows.findIndex((row) => row.id === target.id);
  const projected = editor.effectiveElement(record.id);
  check('中间插行保持来源行身份、尺寸与单元格文字归属',
    after.rows.length === before.rows.length + 1
      && targetIndex === 1
      && after.rows[0].source === null
      && plain(projected.rows[targetIndex].cells[0]).startsWith('稳定逻辑格')
      && projected.h === projected.rows.reduce((sum, row) => sum + row.height, 0),
    JSON.stringify({ targetIndex, after, h: projected.h,
      rowHeight: projected.rows.reduce((sum, row) => sum + row.height, 0),
      text: plain(projected.rows[targetIndex].cells[0]) }));

  const sourceRow = after.rows.find((row) => row.source === 0);
  const sourceColumn = after.columns[1];
  editor.exec({
    type: 'EditText', id: record.id, cell: { r: targetIndex, c: 1 },
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 },
      to: { p: 0, r: 0, off: 0 }, text: '稳定列',
    }],
  });
  editor.exec({ type: 'InsertColumn', id: record.id, at: { before: sourceColumn.id } });
  const withColumn = edit.queryTableGrid(doc, record.id);
  const insertedColumn = withColumn.columns[1];
  let structure = editor.effectiveElement(record.id);
  check('中间插列保持来源列身份、文字归属并派生 frame 宽度',
    withColumn.columns.length === 3
      && insertedColumn.source === null
      && plain(structure.rows[targetIndex].cells[2]).startsWith('稳定列')
      && structure.w === structure.colWidths.reduce((sum, width) => sum + width, 0));

  editor.exec(
    { type: 'SetRowHeight', id: record.id, row: sourceRow.id, height: 144 },
    { type: 'SetColumnWidth', id: record.id, column: insertedColumn.id, width: 96 },
  );
  structure = editor.effectiveElement(record.id);
  check('稳定行列尺寸覆盖原子同步内部网格与 frame',
    structure.rows[1].height === 144
      && structure.colWidths[1] === 96
      && structure.h === structure.rows.reduce((sum, row) => sum + row.height, 0)
      && structure.w === structure.colWidths.reduce((sum, width) => sum + width, 0));

  const topLeft = { row: withColumn.rows[0].id, column: withColumn.columns[0].id };
  const bottomRight = { row: sourceRow.id, column: insertedColumn.id };
  editor.exec({ type: 'MergeCells', id: record.id, from: topLeft, to: bottomRight });
  editor.exec({
    type: 'SetCellProps', id: record.id, cell: topLeft,
    props: { fill: { type: 'solid', color: '#123456' }, margins: [2, 3, 4, 5], vAlign: 'bottom' },
  });
  structure = editor.effectiveElement(record.id);
  check('合并只有一个矩形真值并投影直接单元格格式',
    structure.rows[0].cells[0].rowSpan === 2
      && structure.rows[0].cells[0].colSpan === 2
      && structure.rows[0].cells[1].merged
      && structure.rows[1].cells[0].merged
      && structure.rows[1].cells[1].merged
      && structure.rows[0].cells[0].fill?.type === 'solid'
      && structure.rows[0].cells[0].fill.color === 'rgb(18,52,86)'
      && structure.rows[0].cells[0].margins.join(',') === '2,3,4,5'
      && structure.rows[0].cells[0].vAlign === 'bottom');

  editor.exec({ type: 'SplitCell', id: record.id, cell: topLeft });
  structure = editor.effectiveElement(record.id);
  check('拆分恢复完整可编辑网格且不留合并占位格',
    structure.rows.every((row) => row.cells.every((cell) =>
      !cell.merged && cell.rowSpan === 1 && cell.colSpan === 1)));

  editor.exec(
    { type: 'RemoveRow', id: record.id, row: withColumn.rows[0].id },
    { type: 'RemoveColumn', id: record.id, column: insertedColumn.id },
  );
  const removed = edit.queryTableGrid(doc, record.id);
  structure = editor.effectiveElement(record.id);
  check('插入行列可删除且撤销重做保持稳定身份',
    removed.rows.length === 1 && removed.columns.length === 2
      && structure.rows.length === 1 && structure.colWidths.length === 2);
  editor.undo();
  check('批量删除行列可一次撤销', edit.queryTableGrid(doc, record.id).rows.length === 2
    && edit.queryTableGrid(doc, record.id).columns.length === 3);
  editor.redo();
  check('批量删除行列可一次重做', edit.queryTableGrid(doc, record.id).rows.length === 1
    && edit.queryTableGrid(doc, record.id).columns.length === 2);
  edit.disposeDoc(doc);

  const recoveryPresentation = await core.parse(load('sample-edit-basic.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const recoveryBase = edit.createDoc(recoveryPresentation, { idPrefix: 'table-grid-recovery-' });
  const recoveryDoc = structuredClone(recoveryBase);
  const recoveryEditor = new edit.Editor(recoveryDoc);
  const recoveryTable = Object.values(recoveryDoc.elements).find((candidate) => candidate.src.kind === 'table');
  const recoveryFrames = [];
  recoveryEditor.subscribeRecovery((frame) => recoveryFrames.push(frame));
  const recoveryGrid = edit.queryTableGrid(recoveryDoc, recoveryTable.id);
  recoveryEditor.exec({
    type: 'InsertColumn', id: recoveryTable.id, at: { before: recoveryGrid.columns[1].id },
  });
  const recoveryInserted = edit.queryTableGrid(recoveryDoc, recoveryTable.id).columns[1];
  recoveryEditor.exec({
    type: 'SetColumnWidth', id: recoveryTable.id, column: recoveryInserted.id, width: 77,
  });
  const restoredDoc = structuredClone(recoveryBase);
  const restoredEditor = new edit.Editor(restoredDoc, {
    recoveryFrames: JSON.parse(JSON.stringify(recoveryFrames)),
  });
  const restoredGrid = edit.queryTableGrid(restoredDoc, recoveryTable.id);
  check('新增列身份与尺寸可由纯数据恢复日志确定回放且身份水位前进',
    restoredGrid.columns[1].id === recoveryInserted.id
      && restoredGrid.columns[1].width === 77
      && restoredDoc.identity.nextElement === recoveryDoc.identity.nextElement
      && restoredEditor.isDirty());
  edit.disposeDoc(restoredDoc);
  edit.disposeDoc(recoveryDoc);
  edit.disposeDoc(recoveryBase);

  const concurrentPresentation = await core.parse(load('sample-edit-basic.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const concurrentBase = edit.createDoc(concurrentPresentation, { idPrefix: 'table-grid-concurrent-' });
  const leftDoc = structuredClone(concurrentBase);
  const rightDoc = structuredClone(concurrentBase);
  const leftEditor = new edit.Editor(leftDoc, { origin: 'fixed-left' });
  const rightEditor = new edit.Editor(rightDoc, { origin: 'fixed-right' });
  const leftTable = Object.values(leftDoc.elements).find((candidate) => candidate.src.kind === 'table');
  const rightTable = rightDoc.elements[leftTable.id];
  const anchor = edit.queryTableGrid(leftDoc, leftTable.id).columns[1].id;
  const leftInsert = leftEditor.exec({
    type: 'InsertColumn', id: leftTable.id, at: { before: anchor },
  });
  const leftGrid = edit.queryTableGrid(leftDoc, leftTable.id);
  const leftId = leftInsert.forward[0].path[4];
  const leftIndex = leftGrid.columns.findIndex((column) => column.id === leftId);
  leftEditor.exec({
    type: 'EditText', id: leftTable.id, cell: { r: 0, c: leftIndex },
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 }, text: '本地稳定列',
    }],
  });
  const rightInsert = rightEditor.exec({
    type: 'InsertColumn', id: rightTable.id, at: { before: anchor },
  });
  const duplicateDoc = structuredClone(rightDoc);
  const rightId = rightInsert.forward[0].path[4];
  const rightWidth = rightEditor.exec({
    type: 'SetColumnWidth', id: rightTable.id, column: rightId, width: 66,
  });
  let duplicateRejected = false;
  try {
    edit.applyPatches(duplicateDoc, [rightWidth.forward[0], rightWidth.forward[0]]);
  } catch (error) {
    duplicateRejected = String(error).includes('重复修改同一表格网格路径');
  }
  check('外部批次不能用重复网格路径制造顺序相关的末值覆盖', duplicateRejected);
  edit.disposeDoc(duplicateDoc);
  edit.applyPatches(leftDoc, rightInsert.forward);
  const converged = edit.queryTableGrid(leftDoc, leftTable.id);
  const finalLeftIndex = converged.columns.findIndex((column) => column.id === leftId);
  check('固定种子并发插列按分数序收敛且文字覆盖仍绑定本地列身份',
    leftId !== rightId && converged.columns.length === 4
      && finalLeftIndex >= 0
      && plain(leftEditor.effectiveElement(leftTable.id).rows[0].cells[finalLeftIndex])
        .startsWith('本地稳定列'));
  leftEditor.undo();
  leftEditor.undo();
  check('本地撤销不会删除已重基的远端列',
    edit.queryTableGrid(leftDoc, leftTable.id).columns.some((column) => column.id === rightId)
      && !edit.queryTableGrid(leftDoc, leftTable.id).columns.some((column) => column.id === leftId));
  edit.disposeDoc(rightDoc);
  edit.disposeDoc(leftDoc);
  edit.disposeDoc(concurrentBase);

  const mergePresentation = await core.parse(load('sample-editor-table-structure.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const mergeDoc = edit.createDoc(mergePresentation, { idPrefix: 'table-grid-merge-delete-' });
  const mergeEditor = new edit.Editor(mergeDoc);
  const mergeTable = Object.values(mergeDoc.elements).find((candidate) => candidate.src.kind === 'table');
  const mergeGrid = edit.queryTableGrid(mergeDoc, mergeTable.id);
  check('确定性结构固件同时覆盖横纵合并与直接单元格格式',
    mergeGrid.merges.length === 2
      && mergeEditor.effectiveElement(mergeTable.id).rows[0].cells[0].colSpan === 2
      && mergeEditor.effectiveElement(mergeTable.id).rows[1].cells[0].rowSpan === 2
      && mergeEditor.effectiveElement(mergeTable.id).rows[0].cells[0].margins[1] === 8
      && mergeEditor.effectiveElement(mergeTable.id).rows[0].cells[0].margins[3] === 12);
  mergeEditor.exec(
    { type: 'RemoveRow', id: mergeTable.id, row: mergeGrid.rows[1].id },
    { type: 'RemoveColumn', id: mergeTable.id, column: mergeGrid.columns[1].id },
  );
  const decomposed = mergeEditor.effectiveElement(mergeTable.id);
  check('删除穿过横纵合并端点会确定拆分而不留下重叠或越界占位格',
    edit.queryTableGrid(mergeDoc, mergeTable.id).merges.length === 0
      && decomposed.rows.length === 2 && decomposed.colWidths.length === 3
      && decomposed.rows.every((row) => row.cells.every((cell) =>
        !cell.merged && cell.rowSpan === 1 && cell.colSpan === 1)));
  edit.disposeDoc(mergeDoc);
}
