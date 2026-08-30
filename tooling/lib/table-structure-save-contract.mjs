function tableOf(presentation, name) {
  return presentation.slides.flatMap((slide) => slide.elements)
    .find((element) => element.kind === 'table' && element.name === name);
}

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

  const mergeInput = load('sample-editor-table-structure.pptx');
  const mergePresentation = await core.parse(mergeInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const mergeDoc = edit.createDoc(mergePresentation, { idPrefix: 'table-structure-delete-save-' });
  const mergeEditor = new edit.Editor(mergeDoc);
  const mergeRecord = Object.values(mergeDoc.elements).find((candidate) => candidate.src.kind === 'table');
  const mergeGrid = edit.queryTableGrid(mergeDoc, mergeRecord.id);
  mergeEditor.exec(
    { type: 'RemoveRow', id: mergeRecord.id, row: mergeGrid.rows[1].id },
    { type: 'RemoveColumn', id: mergeRecord.id, column: mergeGrid.columns[1].id },
  );
  const mergeSaved = await mergeEditor.saveDetailed();
  saveArtifact('table-structure-delete.pptx', mergeSaved.bytes);
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
  mergeReopened.dispose?.();
  edit.disposeDoc(mergeDoc);
}
