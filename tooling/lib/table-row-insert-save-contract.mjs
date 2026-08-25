import { diffPackageBytes } from '../diff-package.mjs';

const plain = (cell) => cell.text?.paragraphs.map((paragraph) =>
  paragraph.runs.map((run) => run.text).join('')).join('\n') ?? '';

/** 新行先物化、后写文字；保存重开必须等于同一有效投影。 */
export async function runTableRowInsertSaveContract({
  core, edit, load, check, eq, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ 表格追加行保存与重开\x1b[0m');
  const scenario = Object.freeze({
    type: 'insertRow', file: 'sample-edit-basic.pptx', targetName: '表格', text: '新增格',
  });
  const input = load(scenario.file);
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'table-row-save-' });
  const editor = new edit.Editor(doc);
  const record = Object.values(doc.elements).find((candidate) => candidate.src.kind === 'table');
  const before = editor.effectiveElement(record.id);
  editor.exec({ type: 'InsertRow', id: record.id });
  editor.exec({
    type: 'EditText', id: record.id, cell: { r: before.rows.length, c: 0 },
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 },
      to: { p: 0, r: 0, off: 0 }, text: scenario.text,
    }],
  });
  const projected = editor.effectiveElement(record.id);
  const saved = await editor.saveDetailed();
  const artifact = saveArtifact('table-row-insert.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  const reopened = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const table = reopened.slides[0].elements.find((element) => element.kind === 'table');
  check('追加行只重写目标 slide part 且重开得到新增文字与派生高度',
    saved.mode === 'passthrough' && saved.rewrittenEntries === 1
      && diff.added.length === 0 && diff.removed.length === 0
      && diff.changed.join(',') === 'ppt/slides/slide1.xml'
      && table?.kind === 'table' && table.rows.length === before.rows.length + 1
      && table.h === projected.h && plain(table.rows.at(-1).cells[0]) === scenario.text);

  const xml = new TextDecoder().decode(reopened.package.parts['ppt/slides/slide1.xml']);
  check('OOXML 追加一个 a:tr、保留单元格格式并让新格文字 writer 命中真实宿主',
    [...xml.matchAll(/<a:tr\b/g)].length === before.rows.length + 1
      && new RegExp(`<a:t(?:\\s[^>]*)?>${scenario.text}</a:t>`).test(xml)
      && [...xml.matchAll(/<a:tcPr\/?/g)].length >= projected.rows.length * projected.colWidths.length);

  const projectedFingerprint = renderFingerprint(scenario.file, 'projected', scenario);
  const savedFingerprint = renderFingerprint(artifact, 'saved', scenario);
  for (const mode of ['html', 'svg']) {
    eq(`表格追加行保存产物 ${mode} 指纹等于独立进程有效投影`,
      savedFingerprint[mode], projectedFingerprint[mode]);
  }
  reopened.dispose?.();
  edit.disposeDoc(doc);

  const styleScenario = Object.freeze({
    type: 'insertRow', file: 'sample-editor-table-text.pptx', slideIndex: 2,
    targetName: '追加行样式', text: '样式新增', cell: 2,
  });
  const styleInput = load(styleScenario.file);
  const stylePresentation = await core.parse(styleInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const styleDoc = edit.createDoc(stylePresentation, { idPrefix: 'table-row-style-save-' });
  const styleEditor = new edit.Editor(styleDoc);
  const styleRecord = Object.values(styleDoc.elements)
    .find((candidate) => candidate.src.name === styleScenario.targetName);
  styleEditor.exec({ type: 'InsertRow', id: styleRecord.id });
  const styleRow = styleEditor.effectiveElement(styleRecord.id).rows.length - 1;
  styleEditor.exec({
    type: 'EditText', id: styleRecord.id, cell: { r: styleRow, c: styleScenario.cell },
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 },
      to: { p: 0, r: 0, off: 0 }, text: styleScenario.text,
    }],
  });
  const styleProjected = styleEditor.effectiveElement(styleRecord.id);
  const styleSaved = await styleEditor.saveDetailed();
  const styleArtifact = saveArtifact('table-row-insert-styles.pptx', styleSaved.bytes);
  const styleDiff = diffPackageBytes(styleInput, styleSaved.bytes);
  const styleReopened = await core.parse(styleSaved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const styleTable = styleReopened.slides[2].elements
    .find((element) => element.name === styleScenario.targetName);
  const styleXml = new TextDecoder().decode(styleReopened.package.parts['ppt/slides/slide3.xml']);
  const extension = styleXml.indexOf('{4485728A-C22C-4D8B-9C62-18D05E3A3D8C}');
  check('表样式追加只改目标第三页并精确重建 bandRow、lastRow、合并拓扑和输入格式',
    styleDiff.changed.join(',') === 'ppt/slides/slide3.xml'
      && styleTable?.kind === 'table'
      && styleTable.rows.length === styleProjected.rows.length
      && JSON.stringify(styleTable.rows[2].cells[0].fill)
        === JSON.stringify(styleProjected.rows[2].cells[0].fill)
      && JSON.stringify(styleTable.rows[3].cells[0].fill)
        === JSON.stringify(styleProjected.rows[3].cells[0].fill)
      && styleTable.rows[3].cells[0].colSpan === 2 && styleTable.rows[3].cells[1].merged
      && plain(styleTable.rows[3].cells[styleScenario.cell]) === styleScenario.text
      && plain(styleTable.rows[3].cells[3]) === ''
      && styleTable.rows[3].cells[styleScenario.cell].text.paragraphs[0].runs[0].b
      && extension > 0 && styleXml.lastIndexOf('<a:tr', extension) < extension
      && [...styleXml.matchAll(/a14:paraId="00112233"/g)].length === 2);
  const styleProjectedFingerprint = renderFingerprint(styleScenario.file, 'projected', styleScenario);
  const styleSavedFingerprint = renderFingerprint(styleArtifact, 'saved', styleScenario);
  for (const mode of ['html', 'svg']) {
    eq(`表样式追加行保存产物 ${mode} 指纹等于独立进程有效投影`,
      styleSavedFingerprint[mode], styleProjectedFingerprint[mode]);
  }

  styleEditor.exec({
    type: 'PasteElements', payload: edit.copyElements(styleDoc, [styleRecord.id]),
    at: { parentId: styleDoc.slideOrder[2], x: 30, y: 330 },
  });
  const pastedStyleId = styleEditor.selection.ids[0];
  styleEditor.exec({ type: 'InsertRow', id: pastedStyleId });
  const pastedProjected = styleEditor.effectiveElement(pastedStyleId);
  const pastedSpid = styleDoc.elements[pastedStyleId].meta.origin.spid;
  const pastedSaved = await styleEditor.saveDetailed();
  const pastedReopened = await core.parse(pastedSaved.bytes, { lazy: false, assets: 'defer' });
  const pastedTable = pastedReopened.slides[2].elements.find((element) =>
    element.kind === 'table' && element.x === pastedProjected.x && element.rows.length === 5);
  const pastedXml = new TextDecoder().decode(pastedSaved.package.parts['ppt/slides/slide3.xml']);
  const pastedAt = pastedXml.indexOf(`<p:cNvPr id="${pastedSpid}"`);
  const pastedHost = pastedXml.slice(pastedXml.lastIndexOf('<p:graphicFrame>', pastedAt),
    pastedXml.indexOf('</p:graphicFrame>', pastedAt) + '</p:graphicFrame>'.length);
  check('既有复杂表格粘贴后追加仍保留完整来源格式与未知兼容节点',
    pastedTable?.kind === 'table' && pastedTable.rows.length === pastedProjected.rows.length
      && pastedTable.rows[4].cells[0].colSpan === 2 && pastedTable.rows[4].cells[1].merged
      && JSON.stringify(pastedTable.rows[4].cells[0].fill)
        === JSON.stringify(pastedProjected.rows[4].cells[0].fill)
      && [...pastedHost.matchAll(/a14:paraId="00112233"/g)].length === 3
      && [...pastedHost.matchAll(/<mc:AlternateContent\b/g)].length === 3);
  pastedReopened.dispose?.();
  styleReopened.dispose?.();
  edit.disposeDoc(styleDoc);
}
