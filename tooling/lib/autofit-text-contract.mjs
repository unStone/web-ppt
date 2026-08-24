const textOf = (element) => element.text.paragraphs
  .map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n');

/** 有效缩放是排版派生值，headless 命令只提交用户文本。 */
export async function runAutofitTextContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ normAutofit 文字派生状态\x1b[0m');
  const presentation = await core.parse(load('sample-editor-engine-text.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'autofit-text-' });
  const editor = new edit.Editor(doc);
  const record = Object.values(doc.elements)
    .find((candidate) => candidate.src.name === 'Engine 裸自动缩放');
  const sourceText = textOf(record.src);
  const sourceScale = core.layoutText(record.src.text, record.src.w, record.src.h).scale;
  const run = record.src.text.paragraphs[0].runs.at(-1);
  editor.exec({
    type: 'EditText', id: record.id,
    ops: [{
      type: 'replace',
      from: { p: 0, r: record.src.text.paragraphs[0].runs.length - 1, off: run.text.length },
      to: { p: 0, r: record.src.text.paragraphs[0].runs.length - 1, off: run.text.length },
      text: '自动缩放'.repeat(120),
    }],
  });
  const effective = editor.effectiveElement(record.id);
  const projectedScale = core.layoutText(effective.text, effective.w, effective.h).scale;
  check('EditText 同步更新内容但不把有效 autofit 比例写进覆盖或历史',
    textOf(effective).startsWith(sourceText)
      && projectedScale < sourceScale
      && effective.text.fontScale === record.src.text.fontScale
      && record.ovr.text?.kind === 'flat'
      && record.ovr.text.body.fontScale === record.src.text.fontScale
      && record.ovr.text.body.autoFitCompute === true
      && editor.history.undoCount === 1,
  `source=${sourceScale} projected=${projectedScale} stored=${record.ovr.text?.body?.fontScale}`);
  editor.undo();
  check('撤销后文本、派生比例和干净状态同时恢复',
    textOf(editor.effectiveElement(record.id)) === sourceText
      && core.layoutText(record.src.text, record.src.w, record.src.h).scale === sourceScale
      && !editor.isDirty());
  edit.disposeDoc(doc);
}
