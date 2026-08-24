const textOf = (element) => element.text?.paragraphs
  .map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n') ?? '';

/** 只从发布命令、有效投影和保存重开观察字符格式。 */
export async function runRunFormatContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 文字字符格式\x1b[0m');
  const presentation = await core.parse(load('sample-editor-text.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'run-format-' });
  const editor = new edit.Editor(doc);
  const record = Object.values(doc.elements).find((candidate) => candidate.src.name === '重复格式');
  if (!check('字符格式固件含三个相邻格式 run', !!record && textOf(record.src) === '同同同')) return;

  const source = JSON.stringify(record.src.text);
  const caret = { p: 0, r: 0, off: 0 };
  const collapsed = editor.exec({
    type: 'SetRunProps', id: record.id,
    range: { from: caret, to: caret }, props: { b: true },
  });
  check('折叠范围的 headless 字符格式是严格 no-op',
    collapsed.forward.length === 0 && editor.history.undoCount === 0
      && record.ovr.text === undefined && !editor.isDirty());
  let invalidRejected = 0;
  for (const command of [
    { type: 'SetRunProps', id: record.id, range: { from: caret, to: { ...caret, off: 1 } }, props: {} },
    { type: 'SetRunProps', id: record.id, range: { from: caret, to: { ...caret, off: 1 } }, props: { size: 0 } },
    { type: 'SetRunProps', id: record.id, range: { from: caret, to: { ...caret, off: 1 } }, props: { font: ' Aptos ' } },
    { type: 'SetRunProps', id: record.id, range: { from: { ...caret, off: 1 }, to: caret }, props: { b: true } },
    { type: 'SetRunProps', id: record.id, range: { from: caret, to: { ...caret, off: 1 } }, props: { color: '#fff' } },
  ]) {
    try { editor.exec(command); } catch { invalidRejected++; }
  }
  check('字符格式非法数据在落 patch 前原子拒绝',
    invalidRejected === 5 && editor.history.undoCount === 0 && record.ovr.text === undefined);
  const result = editor.exec(JSON.parse(JSON.stringify({
    type: 'SetRunProps', id: record.id,
    range: { from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 1 } },
    props: { b: true },
  })));
  const runs = editor.effectiveElement(record.id).text.paragraphs[0].runs;
  check('SetRunProps 以纯 JSON 命令格式化局部选区且不修改来源',
    runs.map((run) => run.text).join('') === '同同同'
      && runs[0].b === true && runs[1].b === true && runs[2].i === true
      && JSON.stringify(record.src.text) === source
      && result.forward.length === 1 && result.dirtyElements.has(record.id)
      && editor.history.undoCount === 1);

  const whole = {
    from: { p: 0, r: 0, off: 0 },
    to: { p: 0, r: 2, off: 1 },
  };
  const beforeQuery = edit.queryRunProps(editor.doc, record.id, whole);
  editor.exec({
    type: 'SetRunProps', id: record.id, range: whole,
    props: { font: 'Aptos', size: 32, b: false, i: true, u: true, strike: true },
  });
  const afterQuery = edit.queryRunProps(editor.doc, record.id, whole);
  const formatted = editor.effectiveElement(record.id).text.paragraphs[0].runs;
  check('跨 run 设置六个 P0 字符属性并公开报告混合态与统一态',
    beforeQuery.b.mixed === true && beforeQuery.i.mixed === true
      && beforeQuery.font.mixed === true && beforeQuery.size.mixed === false
      && Object.values(afterQuery).every((state) => state.mixed === false)
      && afterQuery.font.value === 'Aptos' && afterQuery.size.value === 32
      && afterQuery.b.value === false && afterQuery.i.value === true
      && afterQuery.u.value === true && afterQuery.strike.value === true
      && formatted.length === 3
      && formatted.every((run) => run.fonts[0] === 'Aptos' && run.size === 32
        && !run.b && run.i && run.u && run.strike));

  const fallbackBody = JSON.parse(JSON.stringify(record.src.text));
  fallbackBody.paragraphs[0].runs[0].fonts = ['Shared Latin', 'EA One'];
  fallbackBody.paragraphs[0].runs[1].fonts = ['Shared Latin', 'EA Two'];
  const fallbackState = edit.queryTextRunProps(fallbackBody, {
    from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 1, off: 1 },
  });
  check('主字体相同但东亚/复杂脚本回退不同仍报告字体混合态',
    fallbackState.font.value === 'Shared Latin' && fallbackState.font.mixed);

  const rich = Object.values(doc.elements).find((candidate) => candidate.src.name === '文本综合');
  const formulaHistory = editor.history.undoCount;
  const formulaResult = editor.exec({
    type: 'SetRunProps', id: rich.id,
    range: { from: { p: 3, r: 1, off: 0 }, to: { p: 3, r: 1, off: 1 } },
    props: { b: true },
  });
  check('公式原子不能拆分且单独格式化不制造伪历史',
    formulaResult.forward.length === 0 && editor.history.undoCount === formulaHistory
      && editor.effectiveElement(rich.id).text.paragraphs[3].runs[1].math?.length > 0);
  editor.exec({
    type: 'SetRunProps', id: rich.id,
    range: {
      from: { p: 0, r: 0, off: 0 },
      to: { p: 1, r: 0, off: rich.src.text.paragraphs[1].runs[0].text.length },
    },
    props: { u: true },
  });
  check('字符格式选区可跨段且不改变文字与段落属性',
    textOf(editor.effectiveElement(rich.id)) === textOf(rich.src)
      && editor.effectiveElement(rich.id).text.paragraphs.slice(0, 2)
        .every((paragraph) => paragraph.runs.filter((run) => !run.math).every((run) => run.u))
      && editor.effectiveElement(rich.id).text.paragraphs[1].rtl === true);

  edit.disposeDoc(doc);

  const resetPresentation = await core.parse(load('sample-editor-text.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const resetDoc = edit.createDoc(resetPresentation, { idPrefix: 'run-reset-' });
  const resetEditor = new edit.Editor(resetDoc);
  const resetRecord = Object.values(resetDoc.elements).find((candidate) => candidate.src.name === '重复格式');
  const splitRecord = Object.values(resetDoc.elements).find((candidate) => candidate.src.name === '中段格式');
  const middle = {
    from: { p: 0, r: 1, off: 0 },
    to: { p: 0, r: 1, off: 1 },
  };
  resetEditor.exec({
    type: 'SetRunProps', id: resetRecord.id, range: middle,
    props: { font: null, size: null, b: null },
  });
  const resetRun = resetEditor.effectiveElement(resetRecord.id).text.paragraphs[0].runs[1];
  check('null 删除直接字符格式并让有效投影立即回到继承值',
    resetRun.text === '同' && resetRun.fonts[0] !== 'Courier New'
      && resetRun.size === 24 && resetRun.b === false);
  resetEditor.undo();
  const restoredRun = resetEditor.effectiveElement(resetRecord.id).text.paragraphs[0].runs[1];
  check('撤销恢复原始直接字符格式且重做再次恢复继承',
    restoredRun.fonts[0] === 'Courier New' && restoredRun.b === true
      && resetEditor.redo() && resetEditor.effectiveElement(resetRecord.id).text.paragraphs[0].runs[1].b === false);

  resetEditor.exec({
    type: 'SetRunProps', id: splitRecord.id,
    range: { from: { p: 0, r: 0, off: 1 }, to: { p: 0, r: 0, off: 4 } },
    props: { b: true },
  });
  const splitRuns = resetEditor.effectiveElement(splitRecord.id).text.paragraphs[0].runs;
  check('单个源 run 的中段格式化切成三个有效 run 且文字不变',
    splitRuns.map((run) => run.text).join('|') === 'A|BCD|E'
      && !splitRuns[0].b && splitRuns[1].b && !splitRuns[2].b
      && textOf(splitRecord.src) === 'ABCDE');

  const resetResult = await resetEditor.saveDetailed();
  const reopened = await core.parse(resetResult.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedRecord = reopened.slides[0].elements.find((element) => element.name === '重复格式');
  const reopenedSplit = reopened.slides[0].elements.find((element) => element.name === '中段格式');
  const reopenedRun = reopenedRecord.text.paragraphs[0].runs[1];
  const reopenedSplitRuns = reopenedSplit.text.paragraphs[0].runs;
  const slideXml = new TextDecoder().decode(reopened.package.parts['ppt/slides/slide1.xml']);
  check('字符格式保存只改目标页并在重开后保持继承语义',
    resetResult.rewrittenEntries === 1
      && reopenedRun.fonts[0] !== 'Courier New' && reopenedRun.size === 24 && !reopenedRun.b
      && !slideXml.includes('Courier New')
      && slideXml.includes('<?format keep?>') && slideXml.includes('<!--paragraph-format-sentinel-->'),
    `rewritten=${resetResult.rewrittenEntries} font=${reopenedRun.fonts.join(',')}`
      + ` size=${reopenedRun.size} b=${reopenedRun.b} xmlFont=${slideXml.includes('Courier New')}`
      + ` sentinels=${slideXml.includes('<?format keep?>')}/${slideXml.includes('<!--paragraph-format-sentinel-->')}`);
  const splitSentinels = [
    '<!--split-before:  keep-->', '<?split-format  keep = "yes"?>',
    '<?split-after   keep="two"?>', '<!--split-after:  keep-->',
  ];
  check('中段格式保存重开保持三段语义与相邻注释、处理指令的原始词法',
    reopenedSplitRuns.map((run) => run.text).join('|') === 'A|BCD|E'
      && !reopenedSplitRuns[0].b && reopenedSplitRuns[1].b && !reopenedSplitRuns[2].b
      && splitSentinels.every((sentinel) => slideXml.includes(sentinel))
      && splitSentinels.every((sentinel, index) => index === 0
        || slideXml.indexOf(splitSentinels[index - 1]) < slideXml.indexOf(sentinel)),
    `runs=${reopenedSplitRuns.map((run) => `${run.text}:${run.b}`).join(',')}`
      + ` sentinels=${splitSentinels.map((sentinel) => slideXml.includes(sentinel)).join('/')}`);

  const resetRich = Object.values(resetDoc.elements).find((candidate) => candidate.src.name === '文本综合');
  resetEditor.exec({
    type: 'SetRunProps', id: resetRecord.id,
    range: { from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 1 } },
    props: { font: 'Noto Sans', size: 31.2, b: true, i: true, u: true, strike: true },
  });
  resetEditor.exec({
    type: 'SetRunProps', id: resetRich.id,
    range: { from: { p: 4, r: 0, off: 0 }, to: { p: 4, r: 0, off: 1 } },
    props: { b: true, size: 28 },
  });
  resetEditor.exec({
    type: 'SetRunProps', id: resetRich.id,
    range: { from: { p: 3, r: 0, off: 0 }, to: { p: 3, r: 2, off: 3 } },
    props: { i: true },
  });
  const formattedResult = await resetEditor.saveDetailed();
  const formattedReopened = await core.parse(formattedResult.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const formattedRecord = formattedReopened.slides[0].elements
    .find((element) => element.name === '重复格式');
  const formattedRich = formattedReopened.slides[0].elements
    .find((element) => element.name === '文本综合');
  const formattedRun = formattedRecord.text.paragraphs[0].runs[0];
  const formattedXml = new TextDecoder()
    .decode(formattedReopened.package.parts['ppt/slides/slide1.xml']);
  check('六个 P0 属性保存重开并把字体写入 latin、ea、cs',
    formattedRun.fonts[0] === 'Noto Sans' && Math.abs(formattedRun.size - 31.2) < 1e-9
      && formattedRun.b && formattedRun.i && formattedRun.u && formattedRun.strike
      && (formattedXml.match(/typeface="Noto Sans"/g) ?? []).length === 3,
    `font=${formattedRun.fonts.join(',')} size=${formattedRun.size}`
      + ` b/i/u/s=${formattedRun.b}/${formattedRun.i}/${formattedRun.u}/${formattedRun.strike}`
      + ` fonts=${(formattedXml.match(/typeface="Noto Sans"/g) ?? []).length}`);
  check('动态字段格式化保留 fld 身份且跨公式选区不破坏公式原子',
    formattedRich.text.paragraphs[4].runs[0].b
      && formattedRich.text.paragraphs[4].runs[0].size === 28
      && formattedRich.text.paragraphs[3].runs.some((run) => run.math?.length)
      && formattedXml.includes('<a:fld'),
    `field=${formattedRich.text.paragraphs[4].runs[0].b}/`
      + `${formattedRich.text.paragraphs[4].runs[0].size}`
      + ` math=${formattedRich.text.paragraphs[3].runs.some((run) => run.math?.length)}`
      + ` fld=${formattedXml.includes('<a:fld')}`);
  edit.disposeDoc(resetDoc);
}
