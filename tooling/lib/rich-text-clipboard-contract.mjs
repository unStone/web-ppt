const textOf = (element) => element.text?.paragraphs
  .map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n') ?? '';

/** 只从发布命令、有效投影与保存重开观察富文本片段。 */
export async function runRichTextClipboardContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 文字富文本片段\x1b[0m');
  const presentation = await core.parse(load('sample-editor-rich-clipboard.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'rich-paste-' });
  const editor = new edit.Editor(doc);
  const record = Object.values(doc.elements).find((candidate) => candidate.src.name === '富文本剪贴板');
  if (!check('富文本固件含可写的多格式文字', !!record)) return;
  const hardBreak = Object.values(doc.elements).find((candidate) => candidate.src.name === '带格式硬换行');
  check('专用固件覆盖带独立行内格式的硬换行', hardBreak?.src.text?.paragraphs[0].runs
    .some((run) => run.text === '\n' && run.u));

  const command = JSON.parse(JSON.stringify({
    type: 'EditText', id: record.id,
    ops: [{
      type: 'replaceFragment',
      from: { p: 0, r: 0, off: 1 }, to: { p: 0, r: 1, off: 1 },
      fragment: {
        paragraphs: [{
          text: '粗常', marks: [
            { from: 0, to: 1, props: { b: true, font: 'Arial', size: 20 } },
            { from: 1, to: 2, props: { i: true } },
          ],
        }],
      },
    }],
  }));
  editor.exec(command);
  const effective = editor.effectiveElement(record.id);
  const inserted = effective.text.paragraphs[0].runs.filter((run) => ['粗', '常'].includes(run.text));
  check('纯 JSON replaceFragment 原子替换选区并保留白名单格式',
    textOf(effective) === '同粗常同' && inserted.length === 2
      && inserted[0].b === true && inserted[0].fonts[0] === 'Arial' && inserted[0].size === 20
      && inserted[1].i === true && editor.history.undoCount === 1);
  editor.undo();
  check('富文本片段用一次撤销恢复来源投影', textOf(editor.effectiveElement(record.id)) === '同同同'
    && editor.history.undoCount === 0 && editor.history.redoCount === 1);
  editor.exec({
    type: 'EditText', id: record.id,
    ops: [{
      type: 'replaceFragment',
      from: { p: 0, r: 0, off: 1 }, to: { p: 0, r: 0, off: 1 },
      fragment: { paragraphs: [{ text: '', marks: [] }] },
    }],
  });
  check('折叠范围粘贴空片段是严格 no-op', editor.history.undoCount === 0
    && editor.history.redoCount === 1 && !editor.isDirty());
  let invalidRejected = false;
  try {
    editor.exec({
      type: 'EditText', id: record.id,
      ops: [{
        type: 'replaceFragment',
        from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 },
        fragment: { paragraphs: [{ text: '坏', marks: [{ from: 1, to: 1, props: { color: 'red' } }] }] },
      }],
    });
  } catch { invalidRejected = true; }
  check('不连续区间与白名单外格式在落 patch 前原子拒绝', invalidRejected
    && editor.history.undoCount === 0 && editor.history.redoCount === 1 && !editor.isDirty());

  editor.redo();
  const current = editor.effectiveElement(record.id).text;
  const lastRun = current.paragraphs[0].runs.at(-1);
  editor.exec({
    type: 'EditText', id: record.id,
    ops: [{
      type: 'replaceFragment',
      from: { p: 0, r: current.paragraphs[0].runs.length - 1, off: lastRun.text.length },
      to: { p: 0, r: current.paragraphs[0].runs.length - 1, off: lastRun.text.length },
      fragment: { paragraphs: [
        { text: 'A\nB', marks: [{ from: 0, to: 3, props: { u: true } }] },
        { text: 'C', marks: [{ from: 0, to: 1, props: { strike: true } }] },
      ] },
    }],
  });
  const saved = await editor.save();
  const reopened = await core.parse(saved, { edit: true, keepPackage: true, lazy: false, assets: 'defer' });
  const reopenedText = reopened.slides.flatMap((slide) => slide.elements)
    .find((element) => element.kind === 'shape' && element.name === record.src.name).text;
  const reopenedRuns = reopenedText.paragraphs.flatMap((paragraph) => paragraph.runs);
  check('多段富文本与段内 br 保存重开后保持内容、格式和继承段落属性',
    reopenedText.paragraphs.length === 2
      && textOf({ text: reopenedText }) === '同粗常同A\nB\nC'
      && reopenedRuns.some((run) => run.text === 'A' && run.u)
      && reopenedRuns.some((run) => run.text === 'B' && run.u)
      && reopenedRuns.some((run) => run.text === '\n')
      && reopenedRuns.some((run) => run.text === 'C' && run.strike)
      && reopenedText.paragraphs[1].align === reopenedText.paragraphs[0].align,
  `text=${textOf({ text: reopenedText })} paragraphs=${reopenedText.paragraphs.length}`
    + ` runs=${JSON.stringify(reopenedRuns.map((run) => ({ text: run.text, u: run.u, strike: run.strike })))}`
    + ` align=${reopenedText.paragraphs.map((paragraph) => paragraph.align).join('/')}`);
  reopened.dispose();
  edit.disposeDoc(doc);

  const mathPresentation = await core.parse(load('sample-math.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const mathDoc = edit.createDoc(mathPresentation, { idPrefix: 'rich-paste-math-' });
  const mathEditor = new edit.Editor(mathDoc);
  const mathRecord = Object.values(mathDoc.elements).find((candidate) => candidate.src.kind === 'shape'
    && candidate.src.text?.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.math?.length)));
  const formulaParagraph = mathRecord.src.text.paragraphs
    .findIndex((paragraph) => paragraph.runs.some((run) => run.math?.length));
  const formulaRun = mathRecord.src.text.paragraphs[formulaParagraph].runs
    .findIndex((run) => run.math?.length);
  let partialFormulaRejected = false;
  try {
    mathEditor.exec({
      type: 'EditText', id: mathRecord.id,
      ops: [{
        type: 'replaceFragment',
        from: { p: formulaParagraph, r: formulaRun, off: 0 },
        to: { p: formulaParagraph, r: formulaRun, off: 2 },
        fragment: { paragraphs: [{ text: '坏', marks: [{ from: 0, to: 1, props: { b: true } }] }] },
      }],
    });
  } catch { partialFormulaRejected = true; }
  mathEditor.exec({
    type: 'EditText', id: mathRecord.id,
    ops: [{
      type: 'replaceFragment',
      from: { p: formulaParagraph, r: formulaRun, off: 0 },
      to: { p: formulaParagraph, r: formulaRun, off: 0 },
      fragment: { paragraphs: [{ text: '前', marks: [{ from: 0, to: 1, props: { i: true } }] }] },
    }],
  });
  const formulaRuns = mathEditor.effectiveElement(mathRecord.id).text.paragraphs[formulaParagraph].runs;
  check('富文本片段只能在公式原子边界替换且失败不污染历史',
    partialFormulaRejected && mathEditor.history.undoCount === 1
      && formulaRuns.some((run) => run.text === '前' && run.i && !run.math)
      && formulaRuns.some((run) => run.math?.length));
  edit.disposeDoc(mathDoc);
}
