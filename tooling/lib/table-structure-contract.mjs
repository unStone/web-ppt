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

  editor.exec({
    type: 'EditText', id: record.id, cell: { r: targetIndex, c: 1 },
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 },
      text: '休眠列',
    }],
  });
  editor.exec({
    type: 'SetCellProps', id: record.id,
    cell: { row: sourceRow.id, column: insertedColumn.id },
    props: { fill: { type: 'solid', color: '#446688' } },
  });
  editor.exec({ type: 'RemoveColumn', id: record.id, column: insertedColumn.id });
  const afterInsertedRemoval = editor.effectiveElement(record.id);
  const removalKeptSourceText = plain(afterInsertedRemoval.rows[targetIndex].cells[1])
    .startsWith('稳定列');
  editor.undo();
  const afterInsertedUndo = editor.effectiveElement(record.id);
  check('删除中间新增列只隐藏自身覆盖且撤销恢复同一稳定列身份与内容格式',
    removalKeptSourceText
      && plain(afterInsertedUndo.rows[targetIndex].cells[1]) === '休眠列'
      && afterInsertedUndo.rows[targetIndex].cells[1].fill?.type === 'solid'
      && plain(afterInsertedUndo.rows[targetIndex].cells[2]).startsWith('稳定列'));

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

  editor.exec(
    { type: 'SetColumnWidth', id: record.id, column: insertedColumn.id, width: 97 },
    { type: 'SetColumnWidth', id: record.id, column: insertedColumn.id, width: 98 },
  );
  const sequentialApplied = edit.queryTableGrid(doc, record.id).columns[1].width;
  editor.undo();
  const sequentialUndone = edit.queryTableGrid(doc, record.id).columns[1].width;
  editor.redo();
  const sequentialRedone = edit.queryTableGrid(doc, record.id).columns[1].width;
  check('同一事务连续修改同一网格路径按末值提交且可整体撤销重做',
    sequentialApplied === 98 && sequentialUndone === 96 && sequentialRedone === 98);

  const topLeft = { row: withColumn.rows[0].id, column: withColumn.columns[0].id };
  const bottomRight = { row: sourceRow.id, column: insertedColumn.id };
  editor.exec({ type: 'MergeCells', id: record.id, from: topLeft, to: bottomRight });
  const mergeSnapshot = edit.queryTableGrid(doc, record.id);
  const stableMergeRow = mergeSnapshot.merges[0].from.row;
  mergeSnapshot.merges[0].from.row = '外部篡改';
  check('查询得到的合并区域是深拷贝且不能绕过命令污染模型',
    edit.queryTableGrid(doc, record.id).merges[0].from.row === stableMergeRow);
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

  editor.exec({ type: 'RemoveRow', id: record.id, row: sourceRow.id });
  const shrunkMerge = edit.queryTableGrid(doc, record.id);
  const shrinkValid = shrunkMerge.rows.length === 1 && shrunkMerge.merges.length === 1
    && shrunkMerge.merges[0].from.row === shrunkMerge.rows[0].id
    && shrunkMerge.merges[0].to.row === shrunkMerge.rows[0].id;
  editor.undo();
  check('删除显式合并端点会原子缩减合并且撤销恢复原矩形',
    shrinkValid && editor.effectiveElement(record.id).rows[0].cells[0].rowSpan === 2);

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

  const textGridPresentation = await core.parse(load('sample-edit-basic.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const textGridDoc = edit.createDoc(textGridPresentation, { idPrefix: 'table-grid-text-base-' });
  const textGridEditor = new edit.Editor(textGridDoc);
  const textGridTable = Object.values(textGridDoc.elements)
    .find((candidate) => candidate.src.kind === 'table');
  let textGrid = edit.queryTableGrid(textGridDoc, textGridTable.id);
  textGridEditor.exec({
    type: 'InsertColumn', id: textGridTable.id, at: { before: textGrid.columns[1].id },
  });
  textGridEditor.exec({
    type: 'EditText', id: textGridTable.id, cell: { r: 0, c: 1 },
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 },
      text: '中间新格',
    }],
  });
  textGridEditor.exec({ type: 'InsertColumn', id: textGridTable.id });
  textGrid = edit.queryTableGrid(textGridDoc, textGridTable.id);
  const tailColumn = textGrid.columns.at(-1);
  textGridEditor.exec({
    type: 'EditText', id: textGridTable.id, cell: { r: 0, c: textGrid.columns.length - 1 },
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 },
      text: '尾部新格',
    }],
  });
  textGridEditor.exec({
    type: 'SetCellProps', id: textGridTable.id,
    cell: { row: textGrid.rows[0].id, column: tailColumn.id },
    props: { fill: { type: 'solid', color: '#ABCDEF' } },
  });
  const textGridProjected = textGridEditor.effectiveElement(textGridTable.id);
  check('中间与尾部新增列都从空文字模板编辑且直接格式通过模型校验',
    plain(textGridProjected.rows[0].cells[1]) === '中间新格'
      && plain(textGridProjected.rows[0].cells.at(-1)) === '尾部新格'
      && textGridProjected.rows[0].cells.at(-1).fill?.type === 'solid');
  edit.disposeDoc(textGridDoc);

  const stylePresentation = await core.parse(load('sample-editor-table-text.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const styleDoc = edit.createDoc(stylePresentation, { idPrefix: 'table-grid-middle-style-' });
  const styleEditor = new edit.Editor(styleDoc);
  const banded = Object.values(styleDoc.elements)
    .find((candidate) => candidate.src.name === '仅行条纹');
  const sourceBand = JSON.stringify(banded.src.rows[1].cells[0].fill);
  const styleGrid = edit.queryTableGrid(styleDoc, banded.id);
  styleEditor.exec({ type: 'InsertRow', id: banded.id, at: { before: styleGrid.rows[1].id } });
  const styledProjection = styleEditor.effectiveElement(banded.id);
  check('中间插行后来源 bandRow 按最终绝对行号重新求值',
    JSON.stringify(styledProjection.rows[2].cells[0].fill) !== sourceBand
      && JSON.stringify(banded.src.rows[1].cells[0].fill) === sourceBand);
  edit.disposeDoc(styleDoc);

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
  const finalWidthPatch = structuredClone(rightWidth.forward[0]);
  finalWidthPatch.value = 67;
  edit.applyPatches(duplicateDoc, [rightWidth.forward[0], finalWidthPatch]);
  check('外部顺序批次允许同一路径连续绝对写入并确定采用末值',
    edit.queryTableGrid(duplicateDoc, rightTable.id).columns
      .find((column) => column.id === rightId).width === 67);
  edit.disposeDoc(duplicateDoc);

  const reservedProbe = structuredClone(concurrentBase);
  const reservedEditor = new edit.Editor(reservedProbe);
  const reservedTable = Object.values(reservedProbe.elements)
    .find((candidate) => candidate.src.kind === 'table');
  const rowTemplate = reservedEditor.exec({ type: 'InsertRow', id: reservedTable.id }).forward[0];
  const columnTemplate = reservedEditor.exec({ type: 'InsertColumn', id: reservedTable.id }).forward[0];
  const reservedTarget = structuredClone(concurrentBase);
  const beforeReserved = JSON.stringify(reservedTarget.elements[reservedTable.id].ovr);
  let reservedRowRejected = false;
  let reservedColumnRejected = false;
  let numericColumnRejected = false;
  const reservedRow = structuredClone(rowTemplate);
  reservedRow.path[4] = '#r0';
  const reservedColumn = structuredClone(columnTemplate);
  reservedColumn.path[4] = '#c0';
  try { edit.applyPatches(reservedTarget, [reservedRow]); } catch { reservedRowRejected = true; }
  try { edit.applyPatches(reservedTarget, [reservedColumn]); } catch { reservedColumnRejected = true; }
  const numericColumn = structuredClone(columnTemplate);
  numericColumn.path[4] = 7;
  try { edit.applyPatches(reservedTarget, [numericColumn]); } catch { numericColumnRejected = true; }
  check('外部新增行列身份必须为字符串且不能占用来源命名空间，失败不改模型',
    reservedRowRejected && reservedColumnRejected && numericColumnRejected
      && JSON.stringify(reservedTarget.elements[reservedTable.id].ovr) === beforeReserved);
  edit.disposeDoc(reservedTarget);
  edit.disposeDoc(reservedProbe);
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
  const dormantSplitDoc = structuredClone(mergeDoc);
  const dormantSplitEditor = new edit.Editor(dormantSplitDoc);
  const dormantSplitTable = dormantSplitDoc.elements[mergeTable.id];
  const dormantSplitGrid = edit.queryTableGrid(dormantSplitDoc, dormantSplitTable.id);
  const columnRemoval = dormantSplitEditor.exec({
    type: 'RemoveColumn', id: dormantSplitTable.id, column: dormantSplitGrid.columns[1].id,
  });
  dormantSplitEditor.exec({
    type: 'SplitCell', id: dormantSplitTable.id,
    cell: { row: dormantSplitGrid.rows[1].id, column: dormantSplitGrid.columns[0].id },
  });
  edit.applyPatches(dormantSplitDoc, columnRemoval.inverse);
  const afterDormantSplitRestore = edit.queryTableGrid(dormantSplitDoc, dormantSplitTable.id);
  check('隐藏横向合并时拆分无关纵向合并，恢复列仍保留休眠合并真值',
    afterDormantSplitRestore.merges.length === 1
      && afterDormantSplitRestore.merges[0].from.row === dormantSplitGrid.rows[0].id
      && afterDormantSplitRestore.merges[0].from.column === dormantSplitGrid.columns[0].id
      && afterDormantSplitRestore.merges[0].to.column === dormantSplitGrid.columns[1].id);
  edit.disposeDoc(dormantSplitDoc);
  const hiddenCoveredDoc = structuredClone(mergeDoc);
  const hiddenCoveredEditor = new edit.Editor(hiddenCoveredDoc);
  const hiddenCoveredTable = hiddenCoveredDoc.elements[mergeTable.id];
  const hiddenCoveredGrid = edit.queryTableGrid(hiddenCoveredDoc, hiddenCoveredTable.id);
  hiddenCoveredEditor.exec({
    type: 'EditText', id: hiddenCoveredTable.id, cell: { r: 1, c: 2 },
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 },
      text: '隐藏覆盖',
    }],
  });
  hiddenCoveredEditor.exec({
    type: 'SetCellProps', id: hiddenCoveredTable.id,
    cell: { row: hiddenCoveredGrid.rows[1].id, column: hiddenCoveredGrid.columns[2].id },
    props: { fill: { type: 'solid', color: '#335577' } },
  });
  const hiddenColumnRemoval = hiddenCoveredEditor.exec({
    type: 'RemoveColumn', id: hiddenCoveredTable.id, column: hiddenCoveredGrid.columns[2].id,
  });
  hiddenCoveredEditor.exec({
    type: 'MergeCells', id: hiddenCoveredTable.id,
    from: { row: hiddenCoveredGrid.rows[1].id, column: hiddenCoveredGrid.columns[1].id },
    to: { row: hiddenCoveredGrid.rows[1].id, column: hiddenCoveredGrid.columns[3].id },
  });
  edit.applyPatches(hiddenCoveredDoc, hiddenColumnRemoval.inverse);
  const restoredCoveredMerge = hiddenCoveredEditor.effectiveElement(hiddenCoveredTable.id);
  const restoredAsMerged = restoredCoveredMerge.rows[1].cells[1].colSpan === 3
    && restoredCoveredMerge.rows[1].cells[2].merged;
  hiddenCoveredEditor.undo();
  const restoredCoveredOverride = hiddenCoveredEditor.effectiveElement(hiddenCoveredTable.id)
    .rows[1].cells[2];
  check('跨隐藏列合并休眠完整矩形覆盖，撤销合并恢复隐藏格文字格式',
    restoredAsMerged && plain(restoredCoveredOverride).startsWith('隐藏覆盖')
      && restoredCoveredOverride.fill?.type === 'solid');
  edit.disposeDoc(hiddenCoveredDoc);
  const backingRoleDoc = structuredClone(mergeDoc);
  const backingRoleEditor = new edit.Editor(backingRoleDoc);
  const backingRoleTable = backingRoleDoc.elements[mergeTable.id];
  const backingRoleGrid = edit.queryTableGrid(backingRoleDoc, backingRoleTable.id);
  backingRoleEditor.exec({
    type: 'RemoveColumn', id: backingRoleTable.id, column: backingRoleGrid.columns[0].id,
  });
  let backingTextRejected = false;
  let backingFormatRejected = false;
  try {
    backingRoleEditor.exec({
      type: 'EditText', id: backingRoleTable.id, cell: { r: 0, c: 0 },
      ops: [{
        type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 }, text: '非法',
      }],
    });
  } catch { backingTextRejected = true; }
  try {
    backingRoleEditor.exec({
      type: 'SetCellProps', id: backingRoleTable.id,
      cell: { row: backingRoleGrid.rows[0].id, column: backingRoleGrid.columns[1].id },
      props: { fill: { type: 'solid', color: '#112233' } },
    });
  } catch { backingFormatRejected = true; }
  check('删除合并锚点后，被提升的 backing 占位格仍拒绝独立文字与格式编辑',
    backingTextRejected && backingFormatRejected);
  edit.disposeDoc(backingRoleDoc);
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
  const decomposedGrid = edit.queryTableGrid(mergeDoc, mergeTable.id);
  mergeEditor.exec({
    type: 'MergeCells', id: mergeTable.id,
    from: { row: decomposedGrid.rows[0].id, column: decomposedGrid.columns[0].id },
    to: { row: decomposedGrid.rows[0].id, column: decomposedGrid.columns[1].id },
  });
  check('删除来源合并后不会留下悬空真值阻断下一次合并',
    edit.queryTableGrid(mergeDoc, mergeTable.id).merges.length === 1);
  edit.disposeDoc(mergeDoc);
}
