function tableOf(presentation, name) {
  return presentation.slides.flatMap((slide) => slide.elements)
    .find((element) => element.kind === 'table' && element.name === name);
}

const plainCell = (cell) => cell?.text?.paragraphs
  .map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n') ?? '';

function applyScenario(edit, editor, doc, record) {
  const grid = edit.queryTableGrid(doc, record.id);
  editor.exec({ type: 'InsertRow', id: record.id, at: { before: grid.rows[0].id } });
  editor.exec({ type: 'InsertColumn', id: record.id, at: { before: grid.columns[1].id } });
  const inserted = edit.queryTableGrid(doc, record.id);
  editor.exec(
    { type: 'SetRowHeight', id: record.id, row: inserted.rows[0].id, height: 88 },
    { type: 'SetColumnWidth', id: record.id, column: inserted.columns[1].id, width: 72 },
  );
  const from = { row: inserted.rows[0].id, column: inserted.columns[0].id };
  const to = { row: inserted.rows[1].id, column: inserted.columns[1].id };
  editor.exec({ type: 'MergeCells', id: record.id, from, to });
  editor.exec({
    type: 'SetCellProps', id: record.id, cell: from,
    props: { fill: { type: 'solid', color: '#A1B2C3' }, margins: [3, 4, 5, 6], vAlign: 'middle' },
  });
  editor.exec({
    type: 'EditText', id: record.id, cell: { r: 0, c: 0 },
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 },
      text: '结构写回',
    }],
  });
}

function equivalent(actual, projected) {
  return actual?.kind === 'table'
    && actual.rows.length === projected.rows.length
    && actual.colWidths.length === projected.colWidths.length
    && actual.rows[0].height === projected.rows[0].height
    && actual.colWidths[1] === projected.colWidths[1]
    && actual.rows[0].cells[0].rowSpan === 2
    && actual.rows[0].cells[0].colSpan === 2
    && actual.rows[0].cells[1].merged
    && actual.rows[1].cells[0].merged
    && actual.rows[1].cells[1].merged
    && actual.rows[0].cells[0].fill?.type === 'solid'
    && actual.rows[0].cells[0].margins?.join(',') === '3,4,5,6'
    && actual.rows[0].cells[0].vAlign === 'middle'
    && actual.rows[0].cells[0].text?.paragraphs[0].runs
      .map((run) => run.text).join('').startsWith('结构写回')
    && actual.w === projected.w && actual.h === projected.h;
}

/** 同一稳定网格必须在补丁保存和无来源包生成保存中得到相同 OOXML 结果。 */
export async function runTableStructureSaveContract({
  core, edit, load, check, eq, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ 表格稳定网格保存与重开\x1b[0m');
  for (const mode of ['patch', 'generated']) {
    const presentation = await core.parse(load('sample-edit-basic.pptx'), {
      edit: true, keepPackage: true, lazy: false, assets: 'defer',
    });
    const doc = edit.createDoc(presentation, { idPrefix: `table-structure-save-${mode}-` });
    const editor = new edit.Editor(doc);
    const record = Object.values(doc.elements).find((candidate) => candidate.src.kind === 'table');
    applyScenario(edit, editor, doc, record);
    const projected = editor.effectiveElement(record.id);
    if (mode === 'generated') presentation.dispose();
    const saved = await editor.saveDetailed();
    const artifact = saveArtifact(`table-structure-${mode}.pptx`, saved.bytes);
    const reopened = await core.parse(saved.bytes, { lazy: false, assets: 'defer' });
    const actual = tableOf(reopened, record.src.name);
    check(`表格稳定网格${mode === 'patch' ? '补丁' : '生成'}保存重开等于有效投影`,
      equivalent(actual, projected), JSON.stringify({
        projected: { rows: projected.rows.length, cols: projected.colWidths.length,
          h: projected.h, w: projected.w },
        actual: actual?.kind === 'table' ? { rows: actual.rows.length,
          cols: actual.colWidths.length, h: actual.h, w: actual.w } : null,
      }));
    const scenario = { type: 'tableStructure', file: 'sample-edit-basic.pptx', targetName: record.src.name };
    const projectedFingerprint = renderFingerprint(scenario.file, 'projected', scenario);
    const savedFingerprint = renderFingerprint(artifact, 'saved', scenario);
    for (const textMode of ['html', 'svg']) eq(
      `表格稳定网格${mode === 'patch' ? '补丁' : '生成'}保存 ${textMode} 独立进程指纹等价`,
      savedFingerprint[textMode], projectedFingerprint[textMode],
    );
    reopened.dispose?.();
    edit.disposeDoc(doc);
  }

  const stableColumnPresentation = await core.parse(load('sample-edit-basic.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const stableColumnDoc = edit.createDoc(stableColumnPresentation, {
    idPrefix: 'table-structure-source-column-save-',
  });
  const stableColumnEditor = new edit.Editor(stableColumnDoc);
  const stableColumnRecord = Object.values(stableColumnDoc.elements)
    .find((candidate) => candidate.src.kind === 'table');
  stableColumnEditor.exec({
    type: 'EditText', id: stableColumnRecord.id, cell: { r: 0, c: 1 },
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 },
      text: '来源列写回',
    }],
  });
  const stableColumnGrid = edit.queryTableGrid(stableColumnDoc, stableColumnRecord.id);
  stableColumnEditor.exec({
    type: 'InsertColumn', id: stableColumnRecord.id,
    at: { before: stableColumnGrid.columns[1].id },
  });
  const stableColumnSaved = await stableColumnEditor.saveDetailed();
  const stableColumnReopened = await core.parse(stableColumnSaved.bytes, {
    lazy: false, assets: 'defer',
  });
  const stableColumnActual = tableOf(stableColumnReopened, stableColumnRecord.src.name);
  check('先编辑来源列再在其前插列，补丁保存仍按稳定来源列写回',
    plainCell(stableColumnActual?.rows[0].cells[2]).startsWith('来源列写回')
      && !plainCell(stableColumnActual?.rows[0].cells[1]).startsWith('来源列写回'));
  stableColumnReopened.dispose?.();
  edit.disposeDoc(stableColumnDoc);

  const adjacentPresentation = await core.parse(load('sample-edit-basic.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const adjacentDoc = edit.createDoc(adjacentPresentation, { idPrefix: 'table-adjacent-merges-' });
  const adjacentEditor = new edit.Editor(adjacentDoc);
  const adjacentRecord = Object.values(adjacentDoc.elements)
    .find((candidate) => candidate.src.kind === 'table');
  for (let index = 0; index < 3; index++) {
    adjacentEditor.exec({ type: 'InsertRow', id: adjacentRecord.id });
  }
  for (let index = 0; index < 2; index++) {
    adjacentEditor.exec({ type: 'InsertColumn', id: adjacentRecord.id });
  }
  const adjacentGrid = edit.queryTableGrid(adjacentDoc, adjacentRecord.id);
  for (const [r1, c1, r2, c2] of [
    [0, 0, 1, 0], [0, 1, 1, 1],
    [2, 0, 2, 1], [3, 0, 3, 1],
    [0, 2, 1, 2], [2, 2, 2, 3],
  ]) adjacentEditor.exec({
    type: 'MergeCells', id: adjacentRecord.id,
    from: { row: adjacentGrid.rows[r1].id, column: adjacentGrid.columns[c1].id },
    to: { row: adjacentGrid.rows[r2].id, column: adjacentGrid.columns[c2].id },
  });
  const adjacentSaved = await adjacentEditor.saveDetailed();
  saveArtifact('table-structure-adjacent-merges.pptx', adjacentSaved.bytes);
  const adjacentXml = new TextDecoder().decode(adjacentSaved.package.parts['ppt/slides/slide1.xml']);
  const rowAttributes = [...adjacentXml.matchAll(/<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g)]
    .map((match) => [...match[1].matchAll(/<a:tc\b([^>]*)>/g)].map((cell) => cell[1]));
  const adjacentReopened = await core.parse(adjacentSaved.bytes, { lazy: false, assets: 'defer' });
  const adjacentActual = tableOf(adjacentReopened, adjacentRecord.src.name);
  check('相邻纵向、横向与 L 形邻接合并按各自锚点生成单轴占位标记',
    adjacentActual?.rows[0].cells[0].rowSpan === 2
      && adjacentActual.rows[0].cells[1].rowSpan === 2
      && adjacentActual.rows[0].cells[2].rowSpan === 2
      && adjacentActual.rows[2].cells[0].colSpan === 2
      && adjacentActual.rows[2].cells[2].colSpan === 2
      && adjacentActual.rows[3].cells[0].colSpan === 2
      && rowAttributes[1][0].includes('vMerge="1"') && !rowAttributes[1][0].includes('hMerge')
      && rowAttributes[1][1].includes('vMerge="1"') && !rowAttributes[1][1].includes('hMerge')
      && rowAttributes[1][2].includes('vMerge="1"') && !rowAttributes[1][2].includes('hMerge')
      && rowAttributes[2][1].includes('hMerge="1"') && !rowAttributes[2][1].includes('vMerge')
      && rowAttributes[2][3].includes('hMerge="1"') && !rowAttributes[2][3].includes('vMerge')
      && rowAttributes[3][1].includes('hMerge="1"') && !rowAttributes[3][1].includes('vMerge'));
  adjacentReopened.dispose?.();
  edit.disposeDoc(adjacentDoc);

  const mergeInput = load('sample-editor-table-structure.pptx');
  const mergePresentation = await core.parse(mergeInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const mergeDoc = edit.createDoc(mergePresentation, { idPrefix: 'table-structure-delete-save-' });
  const mergeEditor = new edit.Editor(mergeDoc);
  const mergeRecord = Object.values(mergeDoc.elements).find((candidate) => candidate.src.kind === 'table');
  const mergeGrid = edit.queryTableGrid(mergeDoc, mergeRecord.id);
  mergeEditor.exec({
    type: 'EditText', id: mergeRecord.id, cell: { r: 1, c: 1 },
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 },
      text: '删除后休眠',
    }],
  });
  mergeEditor.exec({
    type: 'SetCellProps', id: mergeRecord.id,
    cell: { row: mergeGrid.rows[1].id, column: mergeGrid.columns[1].id },
    props: { fill: { type: 'solid', color: '#778899' } },
  });
  mergeEditor.exec(
    { type: 'RemoveRow', id: mergeRecord.id, row: mergeGrid.rows[1].id },
    { type: 'RemoveColumn', id: mergeRecord.id, column: mergeGrid.columns[1].id },
  );
  const mergeProjected = mergeEditor.effectiveElement(mergeRecord.id);
  const mergeSaved = await mergeEditor.saveDetailed();
  const deleteArtifact = saveArtifact('table-structure-delete.pptx', mergeSaved.bytes);
  const mergeXml = new TextDecoder().decode(mergeSaved.package.parts['ppt/slides/slide1.xml']);
  const mergeReopened = await core.parse(mergeSaved.bytes, { lazy: false, assets: 'defer' });
  const mergeActual = tableOf(mergeReopened, mergeRecord.src.name);
  check('删除穿过来源合并区域写回完整矩形 OOXML 并保留未知扩展',
    mergeActual?.kind === 'table' && mergeActual.rows.length === 2
      && mergeActual.colWidths.length === 3
      && mergeActual.rows.every((row) => row.cells.every((cell) =>
        !cell.merged && cell.rowSpan === 1 && cell.colSpan === 1))
      && mergeXml.includes('uri="{TABLE-STRUCTURE-KEEP}"')
      && mergeXml.includes('fixture:keep'));
  check('删除来源行列后投影与保存重开使用同一稳定来源模板',
    mergeActual?.kind === 'table'
      && mergeActual.rows.every((row, r) => row.cells.every((cell, c) =>
        plainCell(cell) === plainCell(mergeProjected.rows[r].cells[c]))));
  const deleteScenario = {
    type: 'tableStructureDelete', file: 'sample-editor-table-structure.pptx',
    targetName: mergeRecord.src.name,
  };
  const deleteProjectedFingerprint = renderFingerprint(deleteScenario.file, 'projected', deleteScenario);
  const deleteSavedFingerprint = renderFingerprint(deleteArtifact, 'saved', deleteScenario);
  for (const textMode of ['html', 'svg']) eq(
    `删除来源行列保存 ${textMode} 独立进程指纹等价`,
    deleteSavedFingerprint[textMode], deleteProjectedFingerprint[textMode],
  );
  mergeReopened.dispose?.();
  edit.disposeDoc(mergeDoc);

  const placeholderPresentation = await core.parse(mergeInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const placeholderDoc = edit.createDoc(placeholderPresentation, {
    idPrefix: 'table-structure-placeholder-save-',
  });
  const placeholderEditor = new edit.Editor(placeholderDoc);
  const placeholderRecord = Object.values(placeholderDoc.elements)
    .find((candidate) => candidate.src.kind === 'table');
  const placeholderGrid = edit.queryTableGrid(placeholderDoc, placeholderRecord.id);
  placeholderEditor.exec({
    type: 'SetColumnWidth', id: placeholderRecord.id,
    column: placeholderGrid.columns.at(-1).id, width: 271,
  });
  const placeholderSaved = await placeholderEditor.saveDetailed();
  const placeholderReopenedPresentation = await core.parse(placeholderSaved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const placeholderReopenedDoc = edit.createDoc(placeholderReopenedPresentation, {
    idPrefix: 'table-structure-placeholder-reopen-',
  });
  const placeholderReopenedEditor = new edit.Editor(placeholderReopenedDoc);
  const placeholderReopenedRecord = Object.values(placeholderReopenedDoc.elements)
    .find((candidate) => candidate.src.kind === 'table');
  const horizontal = edit.queryTableGrid(placeholderReopenedDoc, placeholderReopenedRecord.id)
    .merges.find((merge) => merge.from.row === '#r0' && merge.from.column === '#c0');
  placeholderReopenedEditor.exec({
    type: 'SplitCell', id: placeholderReopenedRecord.id, cell: horizontal.from,
  });
  check('无关结构保存不会清空来源合并占位格，重开拆分仍恢复其文字',
    plainCell(placeholderReopenedEditor.effectiveElement(placeholderReopenedRecord.id)
      .rows[0].cells[1]) === '横向占位');

  const splitGrid = edit.queryTableGrid(placeholderReopenedDoc, placeholderReopenedRecord.id);
  const dormantCell = { row: splitGrid.rows[0].id, column: splitGrid.columns[1].id };
  placeholderReopenedEditor.exec({
    type: 'EditText', id: placeholderReopenedRecord.id, cell: { r: 0, c: 1 },
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 },
      text: 'CUSTOM_SLEEP',
    }],
  });
  placeholderReopenedEditor.exec({
    type: 'SetCellProps', id: placeholderReopenedRecord.id, cell: dormantCell,
    props: { fill: { type: 'solid', color: '#DDAA33' } },
  });
  placeholderReopenedEditor.exec({
    type: 'MergeCells', id: placeholderReopenedRecord.id,
    from: { row: splitGrid.rows[0].id, column: splitGrid.columns[0].id }, to: dormantCell,
  });
  const dormantSaved = await placeholderReopenedEditor.saveDetailed();
  const dormantArtifact = saveArtifact('table-structure-dormant-placeholder.pptx', dormantSaved.bytes);
  const dormantScenario = {
    type: 'tableDormantPlaceholder', file: 'sample-editor-table-structure.pptx',
    targetName: placeholderReopenedRecord.src.name,
  };
  const dormantProjectedFingerprint = renderFingerprint(
    dormantScenario.file, 'projected', dormantScenario,
  );
  const dormantSavedFingerprint = renderFingerprint(dormantArtifact, 'saved', dormantScenario);
  for (const textMode of ['html', 'svg']) eq(
    `休眠占位格覆盖不改变合并状态的 ${textMode} 独立进程指纹`,
    dormantSavedFingerprint[textMode], dormantProjectedFingerprint[textMode],
  );
  const dormantPresentation = await core.parse(dormantSaved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const dormantDoc = edit.createDoc(dormantPresentation, {
    idPrefix: 'table-structure-dormant-reopen-',
  });
  const dormantEditor = new edit.Editor(dormantDoc);
  const dormantRecord = Object.values(dormantDoc.elements)
    .find((candidate) => candidate.src.kind === 'table');
  const dormantMerge = edit.queryTableGrid(dormantDoc, dormantRecord.id).merges
    .find((merge) => merge.from.row === '#r0' && merge.from.column === '#c0');
  dormantEditor.exec({ type: 'SplitCell', id: dormantRecord.id, cell: dormantMerge.from });
  const restoredDormant = dormantEditor.effectiveElement(dormantRecord.id).rows[0].cells[1];
  check('休眠占位格文字与格式经保存重开后仍由拆分恢复',
    plainCell(restoredDormant).startsWith('CUSTOM_SLEEP')
      && restoredDormant.fill?.type === 'solid'
      && restoredDormant.fill.color === 'rgb(221,170,51)');
  edit.disposeDoc(dormantDoc);
  edit.disposeDoc(placeholderReopenedDoc);
  edit.disposeDoc(placeholderDoc);

  const ordinaryPresentation = await core.parse(load('sample-edit-basic.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const ordinaryDoc = edit.createDoc(ordinaryPresentation, {
    idPrefix: 'table-structure-ordinary-dormant-',
  });
  const ordinaryEditor = new edit.Editor(ordinaryDoc);
  const ordinaryRecord = Object.values(ordinaryDoc.elements)
    .find((candidate) => candidate.src.kind === 'table');
  const ordinaryGrid = edit.queryTableGrid(ordinaryDoc, ordinaryRecord.id);
  ordinaryEditor.exec({
    type: 'EditText', id: ordinaryRecord.id, cell: { r: 0, c: 1 },
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 },
      text: 'DORMANT_NEW',
    }],
  });
  ordinaryEditor.exec({
    type: 'MergeCells', id: ordinaryRecord.id,
    from: { row: ordinaryGrid.rows[0].id, column: ordinaryGrid.columns[0].id },
    to: { row: ordinaryGrid.rows[0].id, column: ordinaryGrid.columns[1].id },
  });
  const ordinarySaved = await ordinaryEditor.saveDetailed();
  const ordinaryReopenedPresentation = await core.parse(ordinarySaved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const ordinaryReopenedDoc = edit.createDoc(ordinaryReopenedPresentation, {
    idPrefix: 'table-structure-ordinary-dormant-reopen-',
  });
  const ordinaryReopenedEditor = new edit.Editor(ordinaryReopenedDoc);
  const ordinaryReopenedRecord = Object.values(ordinaryReopenedDoc.elements)
    .find((candidate) => candidate.src.kind === 'table');
  const ordinaryMerge = edit.queryTableGrid(ordinaryReopenedDoc, ordinaryReopenedRecord.id).merges[0];
  ordinaryReopenedEditor.exec({
    type: 'SplitCell', id: ordinaryReopenedRecord.id, cell: ordinaryMerge.from,
  });
  check('普通来源格变为合并占位格后，休眠文字经保存重开拆分仍恢复',
    plainCell(ordinaryReopenedEditor.effectiveElement(ordinaryReopenedRecord.id)
      .rows[0].cells[1]).startsWith('DORMANT_NEW'));
  edit.disposeDoc(ordinaryReopenedDoc);
  edit.disposeDoc(ordinaryDoc);
}
