const plain = (cell) => cell.text?.paragraphs.map((paragraph) =>
  paragraph.runs.map((run) => run.text).join('')).join('\n') ?? '';

/** 末格追加必须由稳定结构 patch 驱动，不能把整张表塞进历史。 */
export async function runTableRowInsertContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 表格尾部追加行\x1b[0m');
  const presentation = await core.parse(load('sample-edit-basic.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'table-row-' });
  const editor = new edit.Editor(doc);
  const record = Object.values(doc.elements).find((candidate) => candidate.src.kind === 'table');
  const source = JSON.stringify(record.src);
  const before = editor.effectiveElement(record.id);
  let result = null;
  try { result = editor.exec({ type: 'InsertRow', id: record.id }); } catch { /* 红测先记录失败。 */ }
  const inserted = editor.effectiveElement(record.id);
  check('InsertRow 以稀疏结构 patch 追加空白可编辑行并派生 frame 高度',
    result?.forward.length === 1
      && result.forward[0].path[3] === 'tableRows'
      && inserted.rows.length === before.rows.length + 1
      && inserted.h === before.h + before.rows.at(-1).height
      && inserted.rows.at(-1).cells.every((cell) => plain(cell) === ''
        && (cell.text || cell.editInfo?.textTemplate))
      && JSON.stringify(record.src) === source
      && editor.history.byteSize < 4096);
  if (!result) { edit.disposeDoc(doc); return; }

  editor.undo();
  const undone = editor.effectiveElement(record.id);
  editor.redo();
  check('追加行可撤销重做且来源表格保持不可变',
    undone.rows.length === before.rows.length
      && editor.effectiveElement(record.id).rows.length === before.rows.length + 1
      && JSON.stringify(record.src) === source);

  const newRow = editor.effectiveElement(record.id).rows.length - 1;
  editor.exec({
    type: 'EditText', id: record.id, cell: { r: newRow, c: 0 },
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 },
      to: { p: 0, r: 0, off: 0 }, text: '新增格',
    }],
  });
  check('新增行立即复用既有单元格文字命令',
    plain(editor.effectiveElement(record.id).rows[newRow].cells[0]) === '新增格');

  editor.exec({ type: 'InsertRow', id: record.id });
  const stableCellKey = edit.tableCellOverrideKey(record, { r: newRow, c: 0 });
  check('连续追加只增长稀疏行身份且不迁移已有单元格覆盖',
    editor.effectiveElement(record.id).rows.length === before.rows.length + 2
      && plain(editor.effectiveElement(record.id).rows[newRow].cells[0]) === '新增格'
      && Object.keys(record.ovr.tableRows ?? {}).length === 2
      && Object.keys(record.ovr.tableCells ?? {}).join(',') === stableCellKey
      && stableCellKey.includes(result.forward[0].path[4]));

  const clonedDoc = structuredClone(doc);
  const clonedTable = edit.effectiveElement(clonedDoc, record.id);
  check('追加行身份、顺序与单元格文字覆盖可随 EditDoc structuredClone',
    clonedTable.kind === 'table'
      && clonedTable.rows.length === before.rows.length + 2
      && plain(clonedTable.rows[newRow].cells[0]) === '新增格'
      && Object.keys(clonedDoc.elements[record.id].ovr.tableRows ?? {}).length === 2);

  const baseline = JSON.stringify(doc);
  const history = editor.history.undoCount;
  const invalid = [
    { type: 'InsertRow', id: 'missing' },
    { type: 'InsertRow', id: record.id, at: 0 },
    { type: 'InsertRow', id: Object.values(doc.elements).find((candidate) => candidate.src.kind !== 'table').id },
  ].every((command) => {
    try { editor.exec(command); return false; } catch { return true; }
  });
  check('InsertRow 原子拒绝缺失目标、未知位置参数与非表格目标',
    invalid && JSON.stringify(doc) === baseline && editor.history.undoCount === history);

  edit.disposeDoc(doc);

  const atomicPresentation = await core.parse(load('sample-edit-basic.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const atomicDoc = edit.createDoc(atomicPresentation, { idPrefix: 'table-row-atomic-' });
  const atomicTable = Object.values(atomicDoc.elements)
    .find((candidate) => candidate.src.kind === 'table');
  const atomicOrder = edit.fractionalIndexBetween(
    edit.initialFractionalIndex(atomicTable.src.rows.length - 1), null, 'atomic-row',
  );
  const atomicBefore = JSON.stringify(atomicTable.ovr);
  const duplicatePath = ['elements', atomicTable.id, 'ovr', 'tableRows', 'atomic-row'];
  let duplicateRejected = false;
  try {
    edit.applyPatches(atomicDoc, [
      { op: 'insert', path: duplicatePath, value: { order: atomicOrder }, origin: 'peer-a' },
      { op: 'insert', path: duplicatePath, value: { order: atomicOrder }, origin: 'peer-b' },
    ]);
  } catch { duplicateRejected = true; }
  let orderRejected = false;
  try {
    edit.applyPatches(atomicDoc, [
      { op: 'insert', path: duplicatePath, value: { order: atomicOrder }, origin: 'peer-a' },
      {
        op: 'insert',
        path: ['elements', atomicTable.id, 'ovr', 'tableRows', 'atomic-row-2'],
        value: { order: atomicOrder },
        origin: 'peer-b',
      },
    ]);
  } catch { orderRejected = true; }
  let malformedRejected = false;
  try {
    edit.applyPatches(atomicDoc, [{
      op: 'insert',
      path: ['malformed', atomicTable.id, 'bad', 'tableRows', 'malformed-row'],
      value: { order: atomicOrder },
      origin: 'peer-b',
    }]);
  } catch { malformedRejected = true; }
  let unstableTextRejected = false;
  try {
    edit.applyPatches(atomicDoc, [{
      op: 'del',
      path: [
        'elements', atomicTable.id, 'ovr', 'tableCells', atomicTable.src.rows.length, 0, 'text',
      ],
      origin: 'peer-b',
    }]);
  } catch { unstableTextRejected = true; }
  check('批量 patch 原子拒绝重复行路径、冲突顺序、伪造前缀与新增行数字坐标',
    duplicateRejected && orderRejected && malformedRejected && unstableTextRejected
      && JSON.stringify(atomicTable.ovr) === atomicBefore);
  edit.disposeDoc(atomicDoc);

  const transactionPresentation = await core.parse(load('sample-edit-basic.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const transactionDoc = edit.createDoc(transactionPresentation, { idPrefix: 'table-row-transaction-' });
  const transactionEditor = new edit.Editor(transactionDoc, { origin: 'transaction-client' });
  const transactionTable = Object.values(transactionDoc.elements)
    .find((candidate) => candidate.src.kind === 'table');
  const transactionRow = transactionTable.src.rows.length;
  transactionEditor.transaction((transaction) => {
    transaction.exec({ type: 'InsertRow', id: transactionTable.id });
    transaction.exec({
      type: 'EditText', id: transactionTable.id, cell: { r: transactionRow, c: 0 },
      ops: [{
        type: 'replace', from: { p: 0, r: 0, off: 0 },
        to: { p: 0, r: 0, off: 0 }, text: '同事务文字',
      }],
    });
  }, '追加并输入');
  transactionEditor.undo();
  const transactionUndone = transactionEditor.effectiveElement(transactionTable.id);
  transactionEditor.redo();
  const transactionRedone = transactionEditor.effectiveElement(transactionTable.id);
  const dependentEntry = transactionEditor.history.undoEntries[0];
  const rowRemoval = dependentEntry.inverse.find((patch) => patch.path[3] === 'tableRows');
  const textDeletion = dependentEntry.inverse.find((patch) => patch.path[3] === 'tableCells');
  const textSet = dependentEntry.forward.find((patch) => patch.path[3] === 'tableCells');
  const dependentBefore = JSON.stringify(transactionTable.ovr);
  let orphanRemovalRejected = false;
  if (rowRemoval) {
    try { edit.applyPatches(transactionDoc, [rowRemoval]); } catch { orphanRemovalRejected = true; }
  }
  let finalSetRejected = false;
  if (rowRemoval && textDeletion && textSet) {
    try {
      edit.applyPatches(transactionDoc, [textDeletion, textSet, rowRemoval]);
    } catch { finalSetRejected = true; }
  }
  check('同一事务可先追加再输入，并作为一个历史单元原子撤销重做',
    transactionUndone.rows.length === transactionTable.src.rows.length
      && transactionRedone.rows.length === transactionTable.src.rows.length + 1
      && plain(transactionRedone.rows.at(-1).cells[0]) === '同事务文字'
      && transactionEditor.history.undoCount === 1
      && dependentEntry.forward[0].path[4] === dependentEntry.forward[1].path[4]
      && !!rowRemoval && orphanRemovalRejected && finalSetRejected
      && JSON.stringify(transactionTable.ovr) === dependentBefore);
  edit.disposeDoc(transactionDoc);

  const stylePresentation = await core.parse(load('sample-editor-table-text.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const styleDoc = edit.createDoc(stylePresentation, { idPrefix: 'table-row-style-' });
  const styleEditor = new edit.Editor(styleDoc);
  const styled = Object.values(styleDoc.elements)
    .find((candidate) => candidate.src.name === '追加行样式');
  const styledSource = JSON.stringify(styled.src);
  const originalLast = styled.src.rows.at(-1);
  const bandOne = styled.src.rows[1];
  styleEditor.exec({ type: 'InsertRow', id: styled.id });
  let styledTable = styleEditor.effectiveElement(styled.id);
  check('追加后旧末行恢复条纹样式且新末行保留 lastRow 与横向合并输入格式',
    styledTable.rows.length === 4
      && JSON.stringify(styledTable.rows[2].cells[0].fill) !== JSON.stringify(originalLast.cells[0].fill)
      && styledTable.rows[2].cells[0].text.paragraphs[0].runs[0].b === false
      && JSON.stringify(styledTable.rows[3].cells[0].fill) === JSON.stringify(originalLast.cells[0].fill)
      && styledTable.rows[3].cells[0].colSpan === 2
      && styledTable.rows[3].cells[1].merged
      && styledTable.rows[3].cells[0].editInfo.textTemplate.paragraphs[0].runs[0].b
      && JSON.stringify(styled.src) === styledSource);
  styleEditor.exec({ type: 'InsertRow', id: styled.id });
  const twoRowsTable = styleEditor.effectiveElement(styled.id);
  styledTable = twoRowsTable;
  check('连续追加让前一新增行按绝对行号进入正确 bandRow，新行继续承担 lastRow',
    styledTable.rows.length === 5
      && JSON.stringify(styledTable.rows[3].cells[0].fill) === JSON.stringify(bandOne.cells[0].fill)
      && JSON.stringify(styledTable.rows[4].cells[0].fill) === JSON.stringify(originalLast.cells[0].fill)
      && styledTable.rows[3].cells[0].editInfo.textTemplate.paragraphs[0].runs[0].b === false
      && styledTable.rows[4].cells[0].editInfo.textTemplate.paragraphs[0].runs[0].b);
  styleEditor.exec({ type: 'InsertRow', id: styled.id });
  const threeRowsTable = styleEditor.effectiveElement(styled.id);
  check('连续追加复用未受影响行对象，只重建前一末行与新末行',
    threeRowsTable.rows[3] === twoRowsTable.rows[3]
      && threeRowsTable.rows[4] !== twoRowsTable.rows[4]
      && threeRowsTable.rows.length === styled.src.rows.length + 3);

  const bands = Object.values(styleDoc.elements)
    .find((candidate) => candidate.src.name === '仅行条纹');
  const bandStart = bands.src.rows[1].cells[0].fill;
  styleEditor.exec({ type: 'InsertRow', id: bands.id });
  const firstBandAppend = styleEditor.effectiveElement(bands.id);
  styleEditor.exec({ type: 'InsertRow', id: bands.id });
  const secondBandAppend = styleEditor.effectiveElement(bands.id);
  check('未启用 lastRow 时连续追加的当前末行仍按绝对行号交替 bandRow',
    JSON.stringify(firstBandAppend.rows[2].cells[0].fill) !== JSON.stringify(bandStart)
      && JSON.stringify(secondBandAppend.rows[2].cells[0].fill)
        === JSON.stringify(firstBandAppend.rows[2].cells[0].fill)
      && JSON.stringify(secondBandAppend.rows[3].cells[0].fill) === JSON.stringify(bandStart));

  const concurrentPresentation = await core.parse(load('sample-editor-table-text.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const concurrentBase = edit.createDoc(concurrentPresentation, { idPrefix: 'table-row-concurrent-' });
  const localDoc = structuredClone(concurrentBase);
  const peerDoc = structuredClone(concurrentBase);
  const localEditor = new edit.Editor(localDoc, { origin: 'zzzz' });
  const peerEditor = new edit.Editor(peerDoc, { origin: 'aaaa' });
  const localTable = Object.values(localDoc.elements)
    .find((candidate) => candidate.src.name === '追加行样式');
  const peerTable = peerDoc.elements[localTable.id];
  const localInsert = localEditor.exec({ type: 'InsertRow', id: localTable.id });
  const localRow = localTable.src.rows.length;
  localEditor.exec({
    type: 'EditText', id: localTable.id, cell: { r: localRow, c: 2 },
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 },
      to: { p: 0, r: 0, off: 0 }, text: '本地新增格',
    }],
  });
  const peerInsert = peerEditor.exec({ type: 'InsertRow', id: peerTable.id });
  edit.applyPatches(localDoc, peerInsert.forward);
  const concurrentRows = Object.entries(localTable.ovr.tableRows)
    .sort(([, left], [, right]) => left.order < right.order ? -1 : 1);
  const localRowId = localInsert.forward[0].path[4];
  const peerRowId = peerInsert.forward[0].path[4];
  const localIndex = localTable.src.rows.length
    + concurrentRows.findIndex(([id]) => id === localRowId);
  const peerIndex = localTable.src.rows.length
    + concurrentRows.findIndex(([id]) => id === peerRowId);
  const concurrentTable = localEditor.effectiveElement(localTable.id);
  localEditor.undo();
  localEditor.undo();
  check('双克隆并发追加使用不同身份，排序前插不会迁移新增格文字且本地撤销保留远端行',
    localRowId !== peerRowId && peerIndex < localIndex
      && plain(concurrentTable.rows[localIndex].cells[2]) === '本地新增格'
      && plain(concurrentTable.rows[peerIndex].cells[2]) === ''
      && localEditor.effectiveElement(localTable.id).rows.length === localTable.src.rows.length + 1);
  edit.disposeDoc(concurrentBase);
  edit.disposeDoc(localDoc);
  edit.disposeDoc(peerDoc);

  const rebaseDoc = edit.createDoc(stylePresentation, { idPrefix: 'table-row-rebase-' });
  const rebaseEditor = new edit.Editor(rebaseDoc, { origin: 'local' });
  const rebaseTable = Object.values(rebaseDoc.elements)
    .find((candidate) => candidate.src.name === '追加行样式');
  rebaseEditor.exec({ type: 'InsertRow', id: rebaseTable.id });
  rebaseEditor.transaction((transaction) => transaction.exec({
    type: 'InsertRow', id: rebaseTable.id,
  }), '远端追加行', { origin: 'peer', recordHistory: false });
  const rebasedRows = rebaseEditor.effectiveElement(rebaseTable.id).rows.length;
  rebaseEditor.undo();
  check('远端追加使用独立稳定行路径，本地撤销不会覆盖远端行或派生高度',
    rebasedRows === rebaseTable.src.rows.length + 2
      && rebaseEditor.effectiveElement(rebaseTable.id).rows.length === rebaseTable.src.rows.length + 1
      && rebaseEditor.effectiveElement(rebaseTable.id).h
        === rebaseTable.src.h + rebaseTable.src.rows.at(-1).height);
  edit.disposeDoc(rebaseDoc);

  const plainPresentation = await core.parse(load('sample-editor-table-text.pptx'), {
    lazy: false, assets: 'defer',
  });
  const plainTable = plainPresentation.slides[2].elements
    .find((element) => element.name === '追加行样式');
  check('普通预览解析不携带追加行样式模板',
    plainTable?.kind === 'table' && plainTable.editInfo?.tableRowAppend === undefined);
  plainPresentation.dispose?.();
  edit.disposeDoc(styleDoc);
}
