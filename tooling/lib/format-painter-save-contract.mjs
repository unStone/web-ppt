import { diffPackageBytes } from '../diff-package.mjs';

const decoder = new TextDecoder();
const byName = (doc, name) => Object.values(doc.elements)
  .find((record) => record.src.name === name);
const whole = (edit, body) => ({
  from: { p: 0, r: 0, off: 0 },
  to: edit.textPositionAtIndex(body, edit.textBodyEditText(body).length),
});

/** ApplyFormat 只生成既有格式 patch，保存层必须仍保持最小 XML 与身份闭环。 */
export async function runFormatPainterSaveContract({ edit, core, load, check, saveArtifact }) {
  console.log('\n\x1b[36m▸ 格式刷跨页保留型保存\x1b[0m');
  const input = load('sample-editor-format-painter.pptx');
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'format-save-' });
  const editor = new edit.Editor(doc);
  const source = byName(doc, 'format-source');
  const local = byName(doc, 'format-target-local');
  const cross = byName(doc, 'format-target-cross-page');
  const empty = byName(doc, 'format-empty-source');
  const table = byName(doc, 'format-table');
  if (!check('格式刷保存固件建立两页、文字与单元格目标',
    [source, local, cross, empty, table].every((record) => record?.meta.origin))) return;

  const preserved = new Map([local, cross].map((record) => [record.src.name, {
    id: record.src.id, name: record.src.name,
    x: record.src.x, y: record.src.y, w: record.src.w, h: record.src.h,
    text: edit.textBodyEditText(editor.effectiveElement(record.id).text),
    part: record.meta.origin.part, spid: record.meta.origin.spid,
  }]));
  editor.exec({
    type: 'ApplyFormat', from: source.id, to: cross.id,
    mask: ['fill', 'stroke', 'effects', 'run', 'paragraph', 'body'],
  });
  editor.exec({
    type: 'ApplyFormat', from: empty.id, to: local.id,
    mask: ['fill', 'stroke', 'effects'],
  });
  const cellRange = {
    from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 5 },
  };
  editor.exec({
    type: 'ApplyFormat', from: table.id, to: table.id,
    fromCell: { r: 0, c: 0 }, toCell: { r: 0, c: 1 },
    fromRange: cellRange, toRange: cellRange, mask: ['run', 'paragraph', 'body'],
  });
  const expectedSource = structuredClone(editor.effectiveElement(source.id));
  const expectedCross = structuredClone(editor.effectiveElement(cross.id));

  const saved = await editor.saveDetailed();
  const identity = await editor.saveDetailed();
  check('格式刷状态连续保存进入 identity 且复用字节与包对象',
    identity.mode === 'identity' && identity.bytes === saved.bytes
      && identity.package === saved.package);
  saveArtifact('format-painter.pptx', saved.bytes);

  const diff = diffPackageBytes(input, saved.bytes);
  const slideParts = [local.meta.origin.part, cross.meta.origin.part].sort();
  check('跨页格式刷只改两个目标 slide part，媒体、关系和主题直通',
    diff.added.length === 0 && diff.removed.length === 0
      && diff.changed.sort().join(',') === slideParts.join(','),
  `added=${diff.added} removed=${diff.removed} changed=${diff.changed}`);
  const firstXml = decoder.decode(saved.package.parts[local.meta.origin.part]);
  const secondXml = decoder.decode(saved.package.parts[cross.meta.origin.part]);
  check('直接格式写回保留未知相邻 XML、目标 style 和原文本',
    firstXml.includes('value="source-adjacent"')
      && firstXml.includes('value="target-adjacent"')
      && secondXml.includes('<p:style>')
      && firstXml.includes('目标内容不变') && secondXml.includes('跨页目标内容'));

  const reopenedPresentation = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedDoc = edit.createDoc(reopenedPresentation, { idPrefix: 'format-reopen-' });
  const reopenedEditor = new edit.Editor(reopenedDoc);
  const reopenedSource = byName(reopenedDoc, 'format-source');
  const reopenedLocal = byName(reopenedDoc, 'format-target-local');
  const reopenedCross = byName(reopenedDoc, 'format-target-cross-page');
  const reopenedTable = byName(reopenedDoc, 'format-table');
  const actualSource = reopenedEditor.effectiveElement(reopenedSource.id);
  const actualCross = reopenedEditor.effectiveElement(reopenedCross.id);
  const crossRange = whole(edit, actualCross.text);
  const sourceRange = whole(edit, actualSource.text);
  const localEffective = reopenedEditor.effectiveElement(reopenedLocal.id);
  const reopenedCell = reopenedEditor.effectiveElement(reopenedTable.id).rows[0].cells[1];
  check('格式刷保存重开后对象、文字框、字符与段落语义精确',
    JSON.stringify(actualCross.fill) === JSON.stringify(expectedCross.fill)
      && JSON.stringify(actualCross.stroke) === JSON.stringify(expectedCross.stroke)
      && JSON.stringify(actualCross.effects) === JSON.stringify(expectedCross.effects)
      && JSON.stringify(edit.queryRunProps(reopenedDoc, reopenedCross.id, crossRange))
        === JSON.stringify(edit.queryRunProps(reopenedDoc, reopenedSource.id, sourceRange))
      && JSON.stringify(edit.queryParaProps(reopenedDoc, reopenedCross.id, crossRange))
        === JSON.stringify(edit.queryParaProps(reopenedDoc, reopenedSource.id, sourceRange))
      && JSON.stringify(edit.queryBodyProps(reopenedDoc, reopenedCross.id))
        === JSON.stringify(edit.queryBodyProps(reopenedDoc, reopenedSource.id))
      && JSON.stringify(actualSource.fill) === JSON.stringify(expectedSource.fill));
  check('显式空格式与表格单元格文字经保存重开仍保留',
    localEffective.fill?.type === 'none' && localEffective.stroke === null
      && JSON.stringify(localEffective.effects ?? {}) === '{}'
      && edit.textBodyEditText(reopenedCell.text) === '单元格 B'
      && edit.queryRunProps(reopenedDoc, reopenedTable.id, cellRange, { r: 0, c: 1 }).b.value === true);
  check('格式刷不改变目标身份、名称、几何或文本',
    [reopenedLocal, reopenedCross].every((record) => {
      const before = preserved.get(record.src.name);
      const effective = reopenedEditor.effectiveElement(record.id);
      return before.spid === record.meta.origin.spid && before.name === record.src.name
        && before.x === effective.x && before.y === effective.y
        && before.w === effective.w && before.h === effective.h
        && before.text === edit.textBodyEditText(effective.text);
    }));
  edit.disposeDoc(reopenedDoc);

  editor.undo();
  editor.undo();
  editor.undo();
  const reset = await editor.saveDetailed();
  check('三次格式刷全部撤销后恢复首次基线包字节',
    diffPackageBytes(input, reset.bytes).equal);
  editor.redo();
  editor.redo();
  editor.redo();
  const redone = await editor.saveDetailed();
  check('格式刷全部重做后恢复确定性保存产物',
    diffPackageBytes(saved.bytes, redone.bytes).equal);
  edit.disposeDoc(doc);
}
