import { diffPackageBytes } from '../diff-package.mjs';

const plain = (cell) => cell.text?.paragraphs.map((paragraph) =>
  paragraph.runs.map((run) => run.text).join('')).join('\n') ?? '';

function xmlCellContaining(xml, text) {
  const at = xml.indexOf(`>${text}</a:t>`);
  if (at < 0) return null;
  const from = xml.lastIndexOf('<a:tc', at);
  const to = xml.indexOf('</a:tc>', at);
  return from >= 0 && to >= 0 ? xml.slice(from, to + '</a:tc>'.length) : null;
}

/** 单元格覆盖必须与形状文字共用保留型保存，并证明未编辑格仍是原字节。 */
export async function runTableCellTextSaveContract({
  core, edit, load, check, eq, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ 表格单元格文字保存与重开\x1b[0m');
  const scenario = Object.freeze({
    type: 'text', file: 'sample-editor-table-text.pptx', targetName: '表格文字综合',
    edits: [
      {
        targetName: '表格文字综合', cell: { r: 0, c: 0 },
        ops: [{
          type: 'replace', from: { p: 0, r: 1, off: 2 },
          to: { p: 0, r: 1, off: 2 }, text: '保存',
        }],
      },
      {
        targetName: '表格文字综合', cell: { r: 0, c: 1 },
        ops: [{
          type: 'replace', from: { p: 0, r: 0, off: 0 },
          to: { p: 0, r: 0, off: 0 }, text: '空格输入',
        }],
      },
      {
        targetName: '表格文字综合', cell: { r: 1, c: 1 },
        ops: [{
          type: 'replace', from: { p: 0, r: 0, off: 2 },
          to: { p: 0, r: 0, off: 2 }, text: '竖排',
        }],
      },
    ],
    formats: [{
      targetName: '表格文字综合', cell: { r: 0, c: 0 },
      range: { from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 4 } },
      props: { u: true },
    }],
    paragraphFormats: [{
      targetName: '表格文字综合', cell: { r: 1, c: 2 },
      range: { from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 9 } },
      props: { spaceBefore: 5 },
    }],
  });
  const input = load(scenario.file);
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'table-cell-save-' });
  const editor = new edit.Editor(doc);
  const record = Object.values(doc.elements).find((candidate) => candidate.src.name === scenario.targetName);
  if (!check('表格保存固件含可写复杂表格和独立第二页性能表',
    record?.src.kind === 'table' && record.meta.origin && doc.slideOrder.length === 2)) {
    edit.disposeDoc(doc); return;
  }
  for (const change of scenario.edits) editor.exec({
    type: 'EditText', id: record.id, cell: change.cell, ops: change.ops,
  });
  for (const change of scenario.formats) editor.exec({
    type: 'SetRunProps', id: record.id, cell: change.cell,
    range: change.range, props: change.props,
  });
  for (const change of scenario.paragraphFormats) editor.exec({
    type: 'SetParaProps', id: record.id, cell: change.cell,
    range: change.range, props: change.props,
  });

  const beforeXml = new TextDecoder().decode(presentation.package.parts['ppt/slides/slide1.xml']);
  const beforeUntouched = xmlCellContaining(beforeXml, '末格');
  const saved = await editor.saveDetailed();
  const artifact = saveArtifact('table-cell-text-editing.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  const reopened = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const table = reopened.slides[0].elements.find((element) => element.name === scenario.targetName);
  const xml = new TextDecoder().decode(reopened.package.parts['ppt/slides/slide1.xml']);
  const untouched = xmlCellContaining(xml, '末格');
  check('单元格保存只重写目标页且未编辑格保持原始 XML 字节',
    saved.mode === 'passthrough' && diff.added.length === 0 && diff.removed.length === 0
      && diff.changed.join(',') === 'ppt/slides/slide1.xml'
      && beforeUntouched !== null && untouched === beforeUntouched,
  `mode=${saved.mode} changed=${diff.changed.join(',')} untouched=${untouched === beforeUntouched}`);
  check('重开保留内容、空格继承、格式、未知节点、合并、RTL、竖排与 autofit',
    table?.kind === 'table'
      && plain(table.rows[0].cells[0]).includes('中文保存')
      && table.rows[0].cells[0].text.paragraphs[0].runs[0].u
      && plain(table.rows[0].cells[1]) === '空格输入'
      && table.rows[0].cells[1].text.paragraphs[0].runs[0].b
      && plain(table.rows[1].cells[1]).includes('竖排中文')
      && table.rows[1].cells[1].vert === 'vert'
      && table.rows[1].cells[2].text.paragraphs[0].rtl
      && table.rows[1].cells[2].text.paragraphs[0].spaceBefore === 5
      && table.rows[0].cells[2].colSpan === 2 && table.rows[0].cells[3].merged
      && table.rows[1].cells[0].rowSpan === 2 && table.rows[2].cells[0].merged
      && table.rows[1].cells[3].text.autoFitCompute
      && xml.includes('<!--table-rich-gap: keep-->'));

  const projected = renderFingerprint(scenario.file, 'projected', scenario);
  const reparsed = renderFingerprint(artifact, 'saved', scenario);
  for (const mode of ['html', 'svg']) {
    eq(`表格文字保存产物 ${mode} 指纹等于独立进程中的有效投影`,
      reparsed[mode], projected[mode]);
  }
  reopened.dispose?.();
  edit.disposeDoc(doc);
}
