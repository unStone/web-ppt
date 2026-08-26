import { diffPackageBytes } from '../diff-package.mjs';

const decoder = new TextDecoder();
const byName = (doc, name) => Object.values(doc.elements)
  .find((record) => record.src.name === name);

/** 文档级替换必须沿用现有最小 XML 保存器，不能退化为整包重建。 */
export async function runFindReplaceSaveContract({ edit, core, load, check, saveArtifact }) {
  console.log('\n\x1b[36m▸ 文档级查找替换保留型保存\x1b[0m');
  const input = load('sample-editor-find-replace.pptx');
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'find-save-' });
  const editor = new edit.Editor(doc);
  const rich = byName(doc, 'find-rich');
  const table = byName(doc, 'find-table');
  const pageTwo = byName(doc, 'find-page-two');
  const noMatch = byName(doc, 'find-no-match');
  if (!check('查找替换保存固件包含普通文字、表格和三页来源锚点',
    [rich, table, pageTwo, noMatch].every((record) => record?.meta.origin))) return;

  const result = editor.exec({
    type: 'ReplaceText', from: 'Needle', to: '已替换',
    scope: { kind: 'document' }, matchCase: false, wholeWord: true,
  });
  check('全部替换在保存前形成一个跨页历史单元',
    result.dirtySlides.size === 2 && editor.history.undoCount === 1
      && edit.findText(doc, {
        query: '已替换', scope: { kind: 'document' }, matchCase: true, wholeWord: true,
      }).length === 6);

  const saved = await editor.saveDetailed();
  const identity = await editor.saveDetailed();
  check('替换连续保存进入 identity 并复用字节与包对象',
    identity.mode === 'identity' && identity.bytes === saved.bytes && identity.package === saved.package);
  saveArtifact('find-replace.pptx', saved.bytes);

  const diff = diffPackageBytes(input, saved.bytes);
  const changedSlides = [rich.meta.origin.part, pageTwo.meta.origin.part].sort();
  check('跨页替换只改实际命中的两个 slide part',
    diff.added.length === 0 && diff.removed.length === 0
      && diff.changed.sort().join(',') === changedSlides.join(','),
  `added=${diff.added} removed=${diff.removed} changed=${diff.changed}`);
  const firstXml = decoder.decode(saved.package.parts[rich.meta.origin.part]);
  const secondXml = decoder.decode(saved.package.parts[pageTwo.meta.origin.part]);
  const thirdPart = noMatch.meta.origin.part;
  check('文字写回保留未知相邻 XML、字段、公式及未命中后缀',
    firstXml.includes('value="adjacent"') && firstXml.includes('<a:fld')
      && firstXml.includes('<m:oMath') && firstXml.includes('<m:t>x</m:t>')
      && secondXml.includes('NeedleCase')
      && saved.package.parts[thirdPart] === presentation.package.parts[thirdPart]);

  const reopenedPresentation = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedDoc = edit.createDoc(reopenedPresentation, { idPrefix: 'find-reopen-' });
  const reopenedEditor = new edit.Editor(reopenedDoc);
  const reopenedPageTwo = byName(reopenedDoc, 'find-page-two');
  const reopenedTable = byName(reopenedDoc, 'find-table');
  check('保存重开后六处替换与未命中内容精确',
    edit.findText(reopenedDoc, {
      query: '已替换', scope: { kind: 'document' }, matchCase: true, wholeWord: true,
    }).length === 6
      && edit.textBodyEditText(reopenedEditor.effectiveElement(reopenedPageTwo.id).text)
        === '已替换 middle 已替换 NeedleCase'
      && edit.textBodyEditText(reopenedEditor.effectiveElement(reopenedTable.id).rows[0].cells[0].text)
        === '已替换 cell A');
  edit.disposeDoc(reopenedDoc);

  editor.undo();
  const restored = await editor.saveDetailed();
  check('替换撤销后逐 part 恢复输入包', diffPackageBytes(input, restored.bytes).equal);
  editor.redo();
  const redone = await editor.saveDetailed();
  check('替换重做后恢复确定性保存产物', diffPackageBytes(saved.bytes, redone.bytes).equal);
  edit.disposeDoc(doc);
}
