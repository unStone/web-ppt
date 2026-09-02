const textOf = (element) => element.text?.paragraphs
  .map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n') ?? '';

/** 从公开命令、结构查询和有效投影观察高级字符格式。 */
export async function runAdvancedRunFormatContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 高级字符格式与清除格式\x1b[0m');
  const fixture = await core.parse(load('sample-editor-advanced-run-format.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const fixtureDoc = edit.createDoc(fixture, { idPrefix: 'advanced-fixture-' });
  const fixtureRecords = Object.values(fixtureDoc.elements);
  const underlineRecord = fixtureRecords.find((candidate) => candidate.src.name === '全部下划线类型');
  const underlineValues = underlineRecord.src.text.paragraphs[0].runs
    .map((run) => run.underline ?? (run.u ? 'sng' : 'none'));
  check('确定性固件覆盖 none 与全部 17 种 DrawingML 下划线',
    JSON.stringify(underlineValues) === JSON.stringify(edit.TEXT_UNDERLINE_STYLES),
    JSON.stringify(underlineValues));
  const inheritedRecord = fixtureRecords
    .find((candidate) => candidate.src.name === '高级格式版式继承');
  const inheritedRun = inheritedRecord.src.text.paragraphs[0].runs[0];
  check('版式与主题共同提供高级字符格式的 Source Value',
    inheritedRun.underline === 'dashHeavy' && inheritedRun.strikeType === 'dblStrike'
      && inheritedRun.highlight === 'rgb(112,173,71)' && inheritedRun.spacing === 2
      && inheritedRun.caps === 'small' && inheritedRun.baseline === -12
      && inheritedRun.color === 'rgb(46,117,182)'
      && inheritedRun.editInfo?.inheritedRunProps.underline === 'dashHeavy');
  const directRecord = fixtureRecords
    .find((candidate) => candidate.src.name === '高级字符格式直接值');
  const directRun = directRecord.src.text.paragraphs[0].runs[0];
  check('解析保留高亮、负字距、大小写、baseline 与双线精确值',
    directRun.highlight === 'rgb(255,192,0)' && directRun.spacing === -3
      && directRun.caps === 'all' && directRun.baseline === 30
      && directRun.underline === 'wavyDbl' && directRun.strikeType === 'dblStrike');
  const identityRecord = fixtureRecords
    .find((candidate) => candidate.src.name === '字段链接公式格式身份');
  const identityText = identityRecord.src.text;
  const identityRange = {
    from: { p: 0, r: 0, off: 0 },
    to: edit.textPositionAtIndex(identityText, edit.textBodyEditText(identityText).length),
  };
  const fixtureEditor = new edit.Editor(fixtureDoc);
  const beforeIdentity = identityText.paragraphs[0].runs.map((run) => ({
    text: run.text, field: run.field, link: run.link, math: run.math,
  }));
  fixtureEditor.exec({
    type: 'ClearFormat', id: identityRecord.id,
    range: { from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 2 } },
  });
  const partialField = edit.effectiveElement(fixtureDoc, identityRecord.id).text
    .paragraphs[0].runs.find((run) => run.field === 'datetime1');
  check('局部清除动态字段按字段原子恢复 Source Value，不把字段拆成普通文字',
    partialField?.text === identityText.paragraphs[0].runs[0].text && !partialField.u);
  fixtureEditor.undo();
  fixtureEditor.exec({
    type: 'ClearFormat', id: identityRecord.id, range: identityRange,
  });
  const afterIdentity = edit.effectiveElement(fixtureDoc, identityRecord.id).text
    .paragraphs[0].runs.map((run) => ({
      text: run.text, field: run.field, link: run.link, math: run.math,
    }));
  check('ClearFormat 保留字段、超链接与公式原子身份',
    JSON.stringify(afterIdentity) === JSON.stringify(beforeIdentity)
      && afterIdentity.some((run) => run.field === 'datetime1'
        && run.link === 'https://example.com/advanced-format')
      && afterIdentity.some((run) => run.math?.length));

  const noHighlightRange = {
    from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 1 },
  };
  fixtureEditor.exec({
    type: 'ApplyFormat', from: underlineRecord.id, to: inheritedRecord.id,
    mask: ['run'], fromRange: noHighlightRange, toRange: noHighlightRange,
  });
  const painterHighlight = edit.queryRunProps(
    fixtureDoc, inheritedRecord.id, noHighlightRange,
  ).highlight.value;
  fixtureEditor.undo();
  const fragment = edit.textFragmentFromRange(underlineRecord.src.text, noHighlightRange);
  fixtureEditor.exec({
    type: 'EditText', id: inheritedRecord.id,
    ops: [{
      type: 'replaceFragment', ...noHighlightRange, fragment,
    }],
  });
  const clipboardHighlight = edit.queryRunProps(
    fixtureDoc, inheritedRecord.id, noHighlightRange,
  ).highlight.value;
  check('格式刷与富文本片段把“无高亮”物化到继承高亮目标',
    painterHighlight === null && clipboardHighlight === null,
    JSON.stringify({ painterHighlight, clipboardHighlight }));
  fixtureEditor.undo();
  const longRecord = fixtureRecords
    .find((candidate) => candidate.src.name === '高级格式两千字符');
  check('专用固件包含 2,000 字符高级格式性能输入',
    edit.textBodyEditText(longRecord.src.text).length === 2000);
  edit.disposeDoc(fixtureDoc);
  fixture.dispose?.();

  const presentation = await core.parse(load('sample-editor-text.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'advanced-run-' });
  const editor = new edit.Editor(doc);
  const record = Object.values(doc.elements)
    .find((candidate) => candidate.src.name === '重复格式');
  const range = {
    from: { p: 0, r: 0, off: 0 },
    to: { p: 0, r: 0, off: 1 },
  };
  let result;
  try {
    result = editor.exec({
      type: 'SetRunProps', id: record.id, range,
      props: {
        highlight: '#FFF176', spacing: 2, caps: 'all', baseline: 30,
        underline: 'wavyDbl', strikeType: 'dblStrike',
        link: { kind: 'external', href: 'https://example.com/advanced' },
      },
    });
  } catch (error) {
    result = error;
  }
  const run = editor.effectiveElement(record.id).text.paragraphs[0].runs[0];
  const state = edit.queryRunProps(doc, record.id, range);
  check('SetRunProps 精确设置六类高级字符属性并保持文字内容',
    !(result instanceof Error)
      && textOf(editor.effectiveElement(record.id)) === '同同同'
      && run.highlight === 'rgb(255,241,118)' && run.spacing === 2
      && run.caps === 'all' && run.baseline === 30
      && run.underline === 'wavyDbl' && run.u
      && run.strikeType === 'dblStrike' && run.strike
      && state.highlight.value === 'rgb(255,241,118)'
      && state.spacing.value === 2 && state.caps.value === 'all'
      && state.baseline.value === 30 && state.underline.value === 'wavyDbl'
      && state.strikeType.value === 'dblStrike'
      && editor.history.undoCount === 1,
    result instanceof Error ? result.message : JSON.stringify({ run, state }));

  editor.exec({
    type: 'SetRunProps', id: record.id,
    range: { from: { p: 0, r: 1, off: 0 }, to: { p: 0, r: 1, off: 1 } },
    props: {
      highlight: '#22C55E', spacing: -1, caps: 'small', baseline: -25,
      underline: 'dotDashHeavy', strikeType: 'sngStrike',
    },
  });
  const mixed = edit.queryRunProps(doc, record.id, {
    from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 1, off: 1 },
  });
  check('混合选区逐项报告高级字符格式 mixed，不用首个 run 冒充统一值',
    mixed.highlight.mixed && mixed.spacing.mixed && mixed.caps.mixed
      && mixed.baseline.mixed && mixed.underline.mixed && mixed.strikeType.mixed);
  editor.undo();

  let clearResult;
  try {
    clearResult = editor.exec({ type: 'ClearFormat', id: record.id, range });
  } catch (error) {
    clearResult = error;
  }
  const cleared = editor.effectiveElement(record.id).text.paragraphs[0].runs[0];
  const clearedParagraph = editor.effectiveElement(record.id).text.paragraphs[0];
  const undoClear = !(clearResult instanceof Error) && editor.undo();
  const restored = editor.effectiveElement(record.id).text.paragraphs[0].runs[0];
  check('ClearFormat 只清选区直接字符格式并可撤销，内容、段落与链接身份不变',
    !(clearResult instanceof Error) && clearResult.forward.length === 1
      && cleared.text === '同' && clearedParagraph.align === 'center'
      && cleared.highlight === null && cleared.spacing === undefined
      && cleared.caps === undefined && cleared.baseline === undefined
      && !cleared.u && !cleared.strike
      && cleared.link === 'https://example.com/advanced'
      && undoClear && restored.highlight === 'rgb(255,241,118)'
      && restored.underline === 'wavyDbl' && restored.strikeType === 'dblStrike'
      && restored.link === cleared.link,
    clearResult instanceof Error ? clearResult.message : JSON.stringify({ cleared, restored }));
  const slide = edit.toSlide(doc, doc.slideOrder[0]);
  const htmlSvg = core.renderSlideToSvg(presentation, slide, {
    textMode: 'html', idPrefix: 'advanced-html-',
  });
  const nativeSvg = core.renderSlideToSvg(presentation, slide, {
    textMode: 'svg', idPrefix: 'advanced-svg-',
  });
  check('HTML 与原生 SVG 分别保留下划线和删除线的精确可表达样式',
    htmlSvg.includes('text-decoration-line:underline;text-decoration-style:wavy')
      && htmlSvg.includes('text-decoration-line:line-through;text-decoration-style:double')
      && nativeSvg.includes('text-decoration-line:underline;text-decoration-style:wavy')
      && nativeSvg.includes('text-decoration-line:line-through;text-decoration-style:double'),
    `html=${htmlSvg.includes('text-decoration-style:wavy')}/${htmlSvg.includes('text-decoration-style:double')}`
      + ` svg=${nativeSvg.includes('text-decoration-style:wavy')}/${nativeSvg.includes('text-decoration-style:double')}`);

  const legacy = edit.flattenTextBody(record.src.text);
  legacy.paragraphs[0].marks[0].runOverrides = { u: true, strike: true };
  const migrated = edit.applyRunProps(record.src.text, range, { highlight: '#AABBCC' }, legacy);
  const migratedOverride = migrated.paragraphs[0].marks[0].runOverrides;
  check('编辑旧版布尔格式时无损迁移为精确兼容值',
    migratedOverride.underline === 'sng' && migratedOverride.strikeType === 'sngStrike'
      && !Object.hasOwn(migratedOverride, 'u') && !Object.hasOwn(migratedOverride, 'strike'),
    JSON.stringify(migratedOverride));

  const emptyPresentation = await core.parse(load('sample-editor-engine-text.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const emptyElement = emptyPresentation.slides.flatMap((candidate) => candidate.elements)
    .find((candidate) => candidate.kind === 'shape' && candidate.name === 'Engine 跨行基准');
  const acrossEmpty = {
    from: { p: 0, r: 0, off: 0 },
    to: { p: 2, r: 0, off: 1 },
  };
  const withEmptyFormat = edit.applyRunProps(emptyElement.text, acrossEmpty, {
    underline: 'wavyHeavy', baseline: 30,
  });
  const emptyMark = withEmptyFormat.paragraphs[1].marks[0];
  const clearedEmpty = edit.clearRunFormat(emptyElement.text, acrossEmpty, withEmptyFormat);
  check('跨段格式与 ClearFormat 都保留空 run 的零宽身份',
    emptyMark.from === 0 && emptyMark.to === 0
      && emptyMark.props.underline === 'wavyHeavy' && emptyMark.props.baseline === 30
      && clearedEmpty.paragraphs[1].marks.length === 1
      && clearedEmpty.paragraphs[1].marks[0].from === 0
      && clearedEmpty.paragraphs[1].marks[0].to === 0
      && clearedEmpty.paragraphs[1].marks[0].clearDirectFormatting === true
      && clearedEmpty.paragraphs[1].marks[0].props.underline !== 'wavyHeavy');
  const bulletDoc = edit.createDoc(emptyPresentation, { idPrefix: 'advanced-bullet-' });
  const bulletRecord = Object.values(bulletDoc.elements)
    .find((candidate) => candidate.src.name === 'Engine 跨行基准');
  const bulletRange = {
    from: { p: 3, r: 0, off: 0 }, to: { p: 3, r: 0, off: 1 },
  };
  new edit.Editor(bulletDoc).exec({
    type: 'SetRunProps', id: bulletRecord.id, range: bulletRange,
    props: {
      underline: 'wavyDbl', strikeType: 'dblStrike', highlight: '#EF4444',
      spacing: 3, caps: 'all', baseline: 30,
    },
  });
  const bulletBody = edit.effectiveElement(bulletDoc, bulletRecord.id).text;
  const sourceBulletSegment = core.layoutText(
    emptyElement.text, bulletRecord.src.w, bulletRecord.src.h,
  ).lines.find((line) => line.paragraphIndex === 3)?.segments.find((segment) => segment.bullet);
  const formattedBulletSegment = core.layoutText(
    bulletBody, bulletRecord.src.w, bulletRecord.src.h,
  ).lines.find((line) => line.paragraphIndex === 3)?.segments.find((segment) => segment.bullet);
  const engineBullet = core.renderTextBodyToHtml(
    bulletBody, bulletRecord.src.w, bulletRecord.src.h, { layout: 'engine' },
  );
  const bulletSlide = edit.toSlide(bulletDoc, bulletDoc.slideOrder[0]);
  const svgBullet = core.renderSlideToSvg(emptyPresentation, bulletSlide, {
    textMode: 'svg', idPrefix: 'advanced-bullet-svg-',
  });
  const withoutBulletSlide = structuredClone(bulletSlide);
  const withoutBullet = withoutBulletSlide.elements
    .find((element) => element.name === bulletRecord.src.name);
  withoutBullet.text.paragraphs[3].bullet = null;
  const svgWithoutBullet = core.renderSlideToSvg(emptyPresentation, withoutBulletSlide, {
    textMode: 'svg', idPrefix: 'advanced-no-bullet-svg-',
  });
  const engineBulletOpen = engineBullet.match(/data-bullet="true"[^>]*/)?.[0] ?? '';
  const svgBulletOpen = svgBullet.match(/<tspan[^>]*font-size[^>]*>• <\/tspan>/)?.[0] ?? '';
  const highlightRects = svgBullet.match(/<rect /g)?.length ?? 0;
  const controlHighlightRects = svgWithoutBullet.match(/<rect /g)?.length ?? 0;
  check('engine 与原生 SVG 的项目符号只借字体字号颜色，不继承正文高级字符格式',
    /data-bullet="true"[^>]*>• <\/span>/.test(engineBullet)
      && svgBulletOpen.length > 0 && highlightRects === controlHighlightRects
      && formattedBulletSegment?.naturalWidth === sourceBulletSegment?.naturalWidth
      && !/(background-color|letter-spacing|text-transform|vertical-align)/.test(engineBulletOpen)
      && !/(letter-spacing|font-variant|\bdy=)/.test(svgBulletOpen),
    JSON.stringify({
      engine: engineBulletOpen, svg: svgBulletOpen, highlightRects, controlHighlightRects,
      sourceWidth: sourceBulletSegment?.naturalWidth,
      formattedWidth: formattedBulletSegment?.naturalWidth,
    }));
  edit.disposeDoc(bulletDoc);
  emptyPresentation.dispose?.();

  const recoveryFrames = [];
  const stopRecovery = editor.subscribeRecovery((frame) => recoveryFrames.push(frame));
  editor.exec({ type: 'ClearFormat', id: record.id, range });
  stopRecovery();
  const recoveredPresentation = await core.parse(load('sample-editor-text.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const recoveredDoc = edit.createDoc(recoveredPresentation, { idPrefix: 'advanced-run-' });
  const recoveredEditor = new edit.Editor(recoveredDoc, {
    recoveryFrames: JSON.parse(JSON.stringify(recoveryFrames)),
  });
  const recoveredRecord = Object.values(recoveredDoc.elements)
    .find((candidate) => candidate.src.name === '重复格式');
  const recoveredRun = recoveredEditor.effectiveElement(recoveredRecord.id).text.paragraphs[0].runs[0];
  check('ClearFormat 恢复帧纯 JSON 往返后恢复来源格式且不伪造历史',
    recoveryFrames.length === 1 && recoveredRun.highlight === null
      && !recoveredRun.u && !recoveredRun.strike && recoveredEditor.history.undoCount === 0);
  edit.disposeDoc(recoveredDoc);
  recoveredPresentation.dispose?.();
  edit.disposeDoc(doc);
}
