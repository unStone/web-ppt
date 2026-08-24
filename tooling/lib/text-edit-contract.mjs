function textOf(element) {
  return element.text?.paragraphs.map((paragraph) =>
    paragraph.runs.map((run) => run.text).join('')).join('\n') ?? '';
}

/** 只从发布命令、有效投影和保存重开观察文字编辑。 */
export async function runTextEditContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 基础文字编辑\x1b[0m');
  const presentation = await core.parse(load('sample-edit-basic.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'text-edit-' });
  const editor = new edit.Editor(doc);
  const record = Object.values(doc.elements).find((candidate) =>
    candidate.src.kind === 'shape' && candidate.src.text && textOf(candidate.src) === '可编辑');
  if (!check('基础文字固件含可写文本形状', !!record)) return;

  const sourceText = textOf(record.src);
  const command = JSON.parse(JSON.stringify({
    type: 'EditText', id: record.id,
    ops: [{
      type: 'replace',
      from: { p: 0, r: 0, off: 1 },
      to: { p: 0, r: 0, off: 2 },
      text: '纯Web',
    }],
  }));
  const result = editor.exec(command);
  check('EditText 以纯 JSON 命令替换选区并只触碰目标元素',
    textOf(editor.effectiveElement(record.id)) === '可纯Web辑'
      && result.forward.length === 1 && result.dirtyElements.has(record.id)
      && textOf(record.src) === sourceText && editor.history.undoCount === 1);
  let invalidOpRejected = false;
  try {
    editor.exec({ type: 'EditText', id: record.id, ops: [{ type: 'browserMagic', at: { p: 0, r: 0, off: 0 } }] });
  } catch { invalidOpRejected = true; }
  check('未知或非纯数据文字操作在落模型前原子拒绝', invalidOpRejected
    && textOf(editor.effectiveElement(record.id)) === '可纯Web辑' && editor.history.undoCount === 1);
  editor.undo();
  check('撤销文字输入恢复来源投影与干净状态',
    textOf(editor.effectiveElement(record.id)) === sourceText && !editor.isDirty());
  editor.redo();
  check('重做文字输入恢复同一有效投影', textOf(editor.effectiveElement(record.id)) === '可纯Web辑');

  const saved = await editor.save();
  const reopened = await core.parse(saved, { edit: true, keepPackage: true, lazy: false, assets: 'defer' });
  const reopenedText = reopened.slides.flatMap((slide) => slide.elements)
    .find((element) => element.kind === 'shape' && element.name === record.src.name);
  check('文字替换保存重开逐字符相等', textOf(reopenedText) === '可纯Web辑');
  edit.disposeDoc(doc);

  const structuralPresentation = await core.parse(load('sample-edit-basic.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const structuralDoc = edit.createDoc(structuralPresentation, { idPrefix: 'text-structure-' });
  const structuralEditor = new edit.Editor(structuralDoc);
  const structuralRecord = Object.values(structuralDoc.elements).find((candidate) =>
    candidate.src.kind === 'shape' && textOf(candidate.src) === '可编辑');
  structuralEditor.exec({
    type: 'EditText', id: structuralRecord.id,
    ops: [{ type: 'splitParagraph', at: { p: 0, r: 0, off: 2 } }],
  });
  let structural = structuralEditor.effectiveElement(structuralRecord.id).text;
  check('Enter 拆成两个段落并保留两侧文字与既有格式',
    structural.paragraphs.length === 2
      && textOf(structuralEditor.effectiveElement(structuralRecord.id)) === '可编\n辑'
      && structural.paragraphs.every((paragraph) => paragraph.runs[0].size === 24));
  structuralEditor.exec({
    type: 'EditText', id: structuralRecord.id,
    ops: [{ type: 'insertLineBreak', at: { p: 1, r: 0, off: 0 } }],
  });
  structural = structuralEditor.effectiveElement(structuralRecord.id).text;
  check('Shift+Enter 只插入段内硬换行', structural.paragraphs.length === 2
    && structural.paragraphs[1].runs.map((run) => run.text).join('') === '\n辑');
  structuralEditor.exec({
    type: 'EditText', id: structuralRecord.id,
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 2 }, to: { p: 1, r: 1, off: 1 }, text: '合',
    }],
  });
  check('跨段替换合并段落且形成独立撤销单元',
    textOf(structuralEditor.effectiveElement(structuralRecord.id)) === '可编合'
      && structuralEditor.history.undoCount === 3);
  structuralEditor.undo();
  check('跨段替换撤销恢复段落与硬换行',
    textOf(structuralEditor.effectiveElement(structuralRecord.id)) === '可编\n\n辑');
  const structuralSaved = await structuralEditor.save();
  const structuralReopened = await core.parse(structuralSaved, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const structuralReopenedText = structuralReopened.slides.flatMap((slide) => slide.elements)
    .find((element) => element.kind === 'shape' && element.name === structuralRecord.src.name);
  check('分段与硬换行保存重开逐字符相等', textOf(structuralReopenedText) === '可编\n\n辑');
  edit.disposeDoc(structuralDoc);

  const mathPresentation = await core.parse(load('sample-math.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const mathDoc = edit.createDoc(mathPresentation, { idPrefix: 'text-math-' });
  const mathEditor = new edit.Editor(mathDoc);
  const mathRecord = Object.values(mathDoc.elements).find((candidate) => candidate.src.kind === 'shape'
    && candidate.src.text?.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.math?.length))
    && candidate.src.text?.paragraphs.some((paragraph) => paragraph.runs.some((run) => !run.math?.length)));
  const mathRun = mathRecord.src.text.paragraphs[0].runs.findIndex((run) => run.math?.length);
  let partialFormulaRejected = false;
  try {
    mathEditor.exec({
      type: 'EditText', id: mathRecord.id,
      ops: [{
        type: 'replace', from: { p: 0, r: mathRun, off: 0 }, to: { p: 0, r: mathRun, off: 2 }, text: '',
      }],
    });
  } catch { partialFormulaRejected = true; }
  check('公式只暴露 0/1 两个原子边界且失败不污染历史',
    partialFormulaRejected && mathEditor.history.undoCount === 0 && !mathEditor.isDirty());
  mathEditor.exec({
    type: 'EditText', id: mathRecord.id,
    ops: [{
      type: 'replace', from: { p: 0, r: mathRun, off: 0 }, to: { p: 0, r: mathRun, off: 0 }, text: '前',
    }],
  });
  const effectiveMath = mathEditor.effectiveElement(mathRecord.id).text.paragraphs[0].runs;
  check('公式边界插字继承视觉格式但不会复制公式语义',
    effectiveMath.filter((run) => run.math?.length).length
      === mathRecord.src.text.paragraphs[0].runs.filter((run) => run.math?.length).length
      && effectiveMath.some((run) => run.text === '前' && !run.math));
  const mathSaved = await mathEditor.save();
  const mathReopened = await core.parse(mathSaved, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedMath = mathReopened.slides.flatMap((slide) => slide.elements)
    .find((element) => element.kind === 'shape' && element.name === mathRecord.src.name);
  check('公式邻接输入保存重开仍保留公式树和新文字',
    textOf(reopenedMath).includes('前')
      && reopenedMath.text.paragraphs[0].runs.some((run) => run.math?.length));
  edit.disposeDoc(mathDoc);

  const fixturePresentation = await core.parse(load('sample-editor-text.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const fixtureDoc = edit.createDoc(fixturePresentation, { idPrefix: 'text-fixture-' });
  const fixtureEditor = new edit.Editor(fixtureDoc);
  const richRecord = Object.values(fixtureDoc.elements).find((candidate) => candidate.src.name === '文本综合');
  const emptyRecord = Object.values(fixtureDoc.elements).find((candidate) => candidate.src.name === '空文本框');
  check('确定性文字固件覆盖多 run、空段、硬换行、RTL、公式、字段与自动缩放',
    richRecord.src.text.paragraphs.length === 5
      && richRecord.src.text.paragraphs[0].runs.some((run) => run.text === '\n')
      && richRecord.src.text.paragraphs[1].rtl === true
      && richRecord.src.text.paragraphs[2].runs.every((run) => run.text === '')
      && richRecord.src.text.paragraphs[3].runs.some((run) => run.math?.length)
      && textOf({ text: { paragraphs: [richRecord.src.text.paragraphs[4]] } }) === '1'
      && richRecord.src.text.fontScale === 0.92
      && emptyRecord.src.text === null && !!emptyRecord.meta.textTemplate);
  fixtureEditor.exec({
    type: 'EditText', id: richRecord.id,
    ops: [
      {
        type: 'replace', from: { p: 0, r: 1, off: 0 }, to: { p: 0, r: 1, off: 2 }, text: '纯网页',
      },
      { type: 'splitParagraph', at: { p: 1, r: 0, off: 5 } },
    ],
  });
  fixtureEditor.exec({
    type: 'EditText', id: emptyRecord.id,
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 }, text: '从空白开始',
    }],
  });
  fixtureEditor.exec({
    type: 'EditText', id: richRecord.id,
    ops: [
      {
        type: 'replace', from: { p: 5, r: 0, off: 0 }, to: { p: 5, r: 0, off: 0 }, text: '第',
      },
      {
        type: 'replace', from: { p: 5, r: 1, off: 1 }, to: { p: 5, r: 1, off: 1 }, text: '页',
      },
    ],
  });
  const fixtureSaved = await fixtureEditor.save();
  const fixtureReopened = await core.parse(fixtureSaved, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedRich = fixtureReopened.slides[0].elements.find((element) => element.name === '文本综合');
  const reopenedEmpty = fixtureReopened.slides[0].elements.find((element) => element.name === '空文本框');
  const richXml = new TextDecoder().decode(fixtureReopened.package.parts['ppt/slides/slide1.xml']);
  check('复杂文字与空文本框保存重开保留内容、公式、段落方向和 bodyPr',
    textOf(reopenedRich).includes('纯网页') && textOf(reopenedEmpty) === '从空白开始'
      && reopenedEmpty.text.paragraphs[0].runs[0].b === true
      && Math.abs(reopenedEmpty.text.paragraphs[0].runs[0].size - 29.3333333333) < 1e-6
      && reopenedRich.text.paragraphs[1].rtl === true && reopenedRich.text.paragraphs[2].rtl === true
      && reopenedRich.text.paragraphs[4].runs.some((run) => run.math?.length)
      && reopenedRich.text.paragraphs[5].runs.map((run) => run.text).join('') === '第1页'
      && richXml.includes('<a:fld')
      && reopenedRich.text.fontScale === 0.92 && reopenedRich.text.lnSpcReduction === 0.08);
  edit.disposeDoc(fixtureDoc);
}
