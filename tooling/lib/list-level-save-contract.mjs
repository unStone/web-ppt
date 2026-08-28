import { diffPackageBytes } from '../diff-package.mjs';

const decoder = new TextDecoder();
const range = (p) => ({ from: { p, r: 0, off: 0 }, to: { p, r: 0, off: 0 } });
const byName = (doc, name) => Object.values(doc.elements)
  .find((record) => record.src.name === name);
const chars = (element) => element.text.paragraphs
  .map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n');
const layout = (element) => element.text.paragraphs.map((paragraph) => [
  paragraph.lvl, paragraph.marL, paragraph.indent, paragraph.bullet, paragraph.runs[0].size,
]);

/** 列表改级保存只能落 pPr@lvl；派生排版由 Office 和重解析继承链共同恢复。 */
export async function runListLevelSaveContract({ core, edit, load, check, saveArtifact }) {
  console.log('\n\x1b[36m▸ 文本列表升降级保存与重开\x1b[0m');
  const input = load('sample-editor-list-level.pptx');
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const sourceXml = decoder.decode(presentation.package.parts['ppt/slides/slide1.xml']);
  const doc = edit.createDoc(presentation, { idPrefix: 'list-level-save-' });
  const editor = new edit.Editor(doc);
  const record = byName(doc, '多级列表');
  const sourceChars = chars(editor.effectiveElement(record.id));
  editor.exec({ type: 'SetParaProps', id: record.id, range: range(2), props: { level: 0 } });
  const expectedLayout = layout(editor.effectiveElement(record.id));
  const changedBytes = JSON.stringify(record.ovr.text);
  check('改级撤销与重做恢复同一纯数据覆盖且字符逐字不变',
    editor.undo() && record.ovr.text === undefined && editor.redo()
      && JSON.stringify(record.ovr.text) === changedBytes
      && chars(editor.effectiveElement(record.id)) === sourceChars);

  const saved = await editor.saveDetailed();
  saveArtifact('list-level-editing.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  const savedXml = decoder.decode(saved.package.parts['ppt/slides/slide1.xml']);
  check('列表改级只重写目标 slide part 的单一 ZIP entry',
    saved.mode === 'passthrough' && saved.rewrittenEntries === 1
      && diff.added.length === 0 && diff.removed.length === 0
      && diff.changed.join(',') === 'ppt/slides/slide1.xml');
  check('保存只改目标 pPr@lvl 并逐字保留未知节点与全部 run',
    savedXml === sourceXml.replace('<a:pPr lvl="1"/>', '<a:pPr lvl="0"/>')
      && savedXml.includes('<!--level-sentinel-->')
      && savedXml.includes('<x:keep value="yes"/>'));

  const reopened = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedElement = reopened.slides[0].elements.find((element) => element.name === '多级列表');
  check('保存重开按 lvl0 继承链恢复缩进、符号、字号和自动编号续号',
    chars(reopenedElement) === sourceChars
      && JSON.stringify(layout(reopenedElement)) === JSON.stringify(expectedLayout),
    JSON.stringify(layout(reopenedElement)));

  const nullPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const nullDoc = edit.createDoc(nullPresentation, { idPrefix: 'list-level-null-save-' });
  const nullEditor = new edit.Editor(nullDoc);
  const nullRecord = byName(nullDoc, '多级列表');
  nullEditor.exec({
    type: 'SetParaProps', id: nullRecord.id, range: range(2), props: { level: null },
  });
  const nullSaved = await nullEditor.saveDetailed();
  const nullXml = decoder.decode(nullSaved.package.parts['ppt/slides/slide1.xml']);
  check('level:null 从来源删除直接 lvl 而不物化零级派生格式',
    nullXml === sourceXml.replace('<a:pPr lvl="1"/>', ''));

  const clearedPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const clearedDoc = edit.createDoc(clearedPresentation, { idPrefix: 'list-level-cleared-save-' });
  const clearedEditor = new edit.Editor(clearedDoc);
  const clearedRecord = byName(clearedDoc, '多级列表');
  const clearedRun = clearedEditor.effectiveElement(clearedRecord.id).text.paragraphs[7].runs[0];
  clearedEditor.exec({
    type: 'SetParaProps', id: clearedRecord.id, range: range(7),
    props: { marginLeft: null, indent: null },
  });
  clearedEditor.exec({
    type: 'SetRunProps', id: clearedRecord.id,
    range: {
      from: { p: 7, r: 0, off: 0 },
      to: { p: 7, r: 0, off: clearedRun.text.length },
    },
    props: { size: null },
  });
  clearedEditor.exec({
    type: 'SetParaProps', id: clearedRecord.id, range: range(7), props: { level: 2 },
  });
  const clearedLayout = layout(clearedEditor.effectiveElement(clearedRecord.id));
  const clearedSaved = await clearedEditor.saveDetailed();
  const clearedReopened = await core.parse(clearedSaved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const clearedElement = clearedReopened.slides[0].elements
    .find((element) => element.name === '多级列表');
  check('清来源直设后改级的保存重开结果与即时预览一致',
    JSON.stringify(layout(clearedElement)) === JSON.stringify(clearedLayout),
    JSON.stringify({ preview: clearedLayout, reopened: layout(clearedElement) }));

  clearedReopened.dispose?.();
  edit.disposeDoc(clearedDoc);
  clearedPresentation.dispose?.();
  edit.disposeDoc(nullDoc);
  nullPresentation.dispose?.();
  reopened.dispose?.();
  edit.disposeDoc(doc);
}
