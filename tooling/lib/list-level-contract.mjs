export async function runListLevelContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 文本列表升降级\x1b[0m');
  const bytes = load('sample-editor-list-level.pptx');
  if (!bytes) return void check('列表层级固件存在', false);
  const presentation = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
  const doc = edit.createDoc(presentation, { idPrefix: 'list-level-' });
  const editor = new edit.Editor(doc);
  const record = Object.values(doc.elements).find((candidate) => candidate.src.name === '多级列表');
  const range = (p) => ({ from: { p, r: 0, off: 0 }, to: { p, r: 0, off: 0 } });
  const paragraphs = () => editor.effectiveElement(record.id).text.paragraphs;

  const baseline = record && paragraphs().map((paragraph) => [
      paragraph.lvl, paragraph.marL, paragraph.bullet, paragraph.runs[0].size,
    ]).slice(0, 7);
  check('固件先证明列表级别、自动编号和符号来源可观测',
    !!record && JSON.stringify(baseline) === JSON.stringify([
      [0, 48, '1.', 32], [0, 48, '2.', 32], [1, 96, '◇', 26.666666666666664],
      [0, 48, '3.', 32], [2, 144, 'a)', 24], [2, 144, 'b)', 24], [8, 432, '■', 16],
    ]), JSON.stringify(baseline));

  editor.exec({ type: 'SetParaProps', id: record.id, range: range(2), props: { level: 0 } });
  const promoted = paragraphs().slice(0, 6).map((paragraph) => [
      paragraph.lvl, paragraph.marL, paragraph.indent, paragraph.bullet, paragraph.runs[0].size,
    ]);
  check('SetParaProps 改级后重算缩进、符号、字号与后续自动编号',
    JSON.stringify(promoted) === JSON.stringify([
      [0, 48, -18, '1.', 32], [0, 48, -18, '2.', 32], [0, 48, -18, '3.', 32],
      [0, 48, -18, '4.', 32], [2, 144, -18, 'a)', 24], [2, 144, -18, 'b)', 24],
    ]), JSON.stringify(promoted));

  const promotedState = edit.queryParaProps(editor.doc, record.id, range(2));
  check('段落属性查询公开当前列表级别且单值不混合',
    promotedState.level.value === 0 && !promotedState.level.mixed);
  const projectedSlide = edit.toSlide(editor.doc, editor.doc.slideOrder[0]);
  const htmlSvg = core.renderSlideToSvg(presentation, projectedSlide, { textMode: 'html' });
  const nativeSvg = core.renderSlideToSvg(presentation, projectedSlide, { textMode: 'svg' });
  check('foreignObject 与原生 text 两条渲染路径消费同一改级后几何',
    htmlSvg.includes('padding-left:48px;text-indent:-18px')
      && htmlSvg.includes('font-size:32px') && htmlSvg.includes('3.&#160;')
      && htmlSvg.includes('4.&#160;') && htmlSvg.includes('二级符号')
      && nativeSvg.includes('<text x="39.6"') && nativeSvg.includes('font-size="32"')
      && nativeSvg.includes('3. ') && nativeSvg.includes('4. ') && nativeSvg.includes('二级符号'));
  const promotedText = paragraphs().map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n');
  check('改级是单个可撤销历史单元且不改变字符内容',
    editor.history.undoCount === 1 && editor.undo()
      && paragraphs()[2].lvl === 1 && paragraphs()[3].bullet === '3.'
      && editor.redo() && paragraphs()[2].lvl === 0
      && paragraphs().map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n')
        === promotedText);

  const historyAtBounds = editor.history.undoCount;
  const lowerBound = editor.exec({
    type: 'SetParaProps', id: record.id, range: range(0), props: { level: 0 },
  });
  const upperBound = editor.exec({
    type: 'SetParaProps', id: record.id, range: range(6), props: { level: 8 },
  });
  check('0/8 边界重复设置严格 no-op',
    lowerBound.forward.length === 0 && upperBound.forward.length === 0
      && editor.history.undoCount === historyAtBounds);

  editor.exec({ type: 'SetParaProps', id: record.id, range: range(4), props: { level: 3 } });
  const previouslyUnused = paragraphs()[4];
  check('目标级别无需先在正文出现也能从 lvlNpPr 目录求值',
    previouslyUnused.lvl === 3 && previouslyUnused.marL === 192
      && previouslyUnused.indent === -18 && previouslyUnused.bullet === '–'
      && previouslyUnused.runs[0].size === 22.666666666666664,
    JSON.stringify([
      previouslyUnused.lvl, previouslyUnused.marL, previouslyUnused.indent,
      previouslyUnused.bullet, previouslyUnused.runs[0].size,
    ]));

  editor.exec({ type: 'SetParaProps', id: record.id, range: range(7), props: { level: 1 } });
  const direct = paragraphs()[7];
  check('列表改级不覆盖段落直接缩进、符号和字符字号',
    direct.lvl === 1 && direct.marL === 220 && direct.indent === -24
      && direct.bullet === '★' && direct.runs[0].size === 34.666666666666664,
    JSON.stringify([direct.lvl, direct.marL, direct.indent, direct.bullet, direct.runs[0].size]));

  editor.exec({
    type: 'SetParaProps', id: record.id, range: range(7),
    props: { marginLeft: null, indent: null },
  });
  editor.exec({
    type: 'SetRunProps', id: record.id,
    range: {
      from: { p: 7, r: 0, off: 0 },
      to: { p: 7, r: 0, off: direct.runs[0].text.length },
    },
    props: { size: null },
  });
  editor.exec({ type: 'SetParaProps', id: record.id, range: range(7), props: { level: 2 } });
  const clearedThenChanged = paragraphs()[7];
  check('先清来源直设再改级时预览采用新级继承值',
    clearedThenChanged.lvl === 2 && clearedThenChanged.marL === 144
      && clearedThenChanged.indent === -18 && clearedThenChanged.bullet === '★'
      && clearedThenChanged.runs[0].size === 24,
    JSON.stringify([
      clearedThenChanged.lvl, clearedThenChanged.marL, clearedThenChanged.indent,
      clearedThenChanged.bullet, clearedThenChanged.runs[0].size,
    ]));

  editor.exec({ type: 'SetParaProps', id: record.id, range: range(2), props: { level: null } });
  const levelOverride = record.ovr.text.paragraphs[2].paragraphOverrides;
  check('level:null 恢复继承零级并保留删除来源直设的意图',
    paragraphs()[2].lvl === 0 && levelOverride.level === null);

  const layoutPresentation = await core.parse(load('sample-editor-change-layout.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const layoutDoc = edit.createDoc(layoutPresentation, { idPrefix: 'list-level-layout-' });
  const layoutEditor = new edit.Editor(layoutDoc);
  const layoutSlide = layoutDoc.slideOrder[0];
  const layoutBody = Object.values(layoutDoc.elements)
    .find((candidate) => candidate.src.name === '现有正文');
  const targetLayout = layoutDoc.layoutOrder
    .find((id) => layoutDoc.layouts[id].name === '重点内容');
  layoutEditor.exec({ type: 'SetLayout', id: layoutSlide, layoutId: targetLayout });
  layoutEditor.exec({
    type: 'SetParaProps', id: layoutBody.id, range: range(1), props: { level: 2 },
  });
  const localLevel = layoutEditor.effectiveElement(layoutBody.id).text.paragraphs[1];
  check('换版式后改级仍让页面局部 lstStyle 压过目标版式目录',
    localLevel.lvl === 2 && localLevel.marL === 180 && localLevel.indent === -20
      && localLevel.bullet === '☞' && localLevel.runs[0].size === 28,
    JSON.stringify([
      localLevel.lvl, localLevel.marL, localLevel.indent,
      localLevel.bullet, localLevel.runs[0].size,
    ]));

  const scalePresentation = await core.parse(load('sample-editor-60.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const scaleDoc = edit.createDoc(scalePresentation, { idPrefix: 'list-level-scale-' });
  const scaleEditor = new edit.Editor(scaleDoc);
  const scaleIds = [...scaleDoc.slides[scaleDoc.slideOrder[0]].children];
  const sourceTemplates = scaleIds.map((id) =>
    scaleDoc.elements[id].src.editInfo?.textLevelTemplate).filter(Boolean);
  scaleEditor.transaction((transaction) => {
    for (const id of scaleIds) transaction.exec({ type: 'RemoveElement', id });
  }, '批量删除样式驻留契约');
  const historyTemplates = scaleEditor.history.undoEntries[0].inverse.flatMap((patch) =>
    Object.values(patch.value?.records ?? {}).map((entry) =>
      entry?.src.editInfo?.textLevelTemplate).filter(Boolean));
  check('同页九级样式目录与批量历史各只保留一份共享纯数据',
    sourceTemplates.length === 60 && new Set(sourceTemplates).size === 1
      && historyTemplates.length === 60 && new Set(historyTemplates).size === 1
      && historyTemplates[0] !== sourceTemplates[0]);
  const externalInverse = structuredClone(scaleEditor.history.undoEntries[0].inverse);
  edit.applyPatches(scaleDoc, externalInverse);
  const restoredTemplates = scaleIds.map((id) =>
    scaleDoc.elements[id].src.editInfo?.textLevelTemplate).filter(Boolean);
  const externalTemplate = Object.values(externalInverse[0].value.records)[0]
    .src.editInfo.textLevelTemplate;
  const restoredMargin = restoredTemplates[0].paragraphs[0].marL;
  externalTemplate.paragraphs[0].marL += 1;
  check('ElementTree 外部 Patch 落模后与共享样式目录严格隔离',
    restoredTemplates.length === 60 && new Set(restoredTemplates).size === 1
      && restoredTemplates[0] !== externalTemplate
      && restoredTemplates[0].paragraphs[0].marL === restoredMargin);
  edit.disposeDoc(scaleDoc);
  scalePresentation.dispose?.();
  edit.disposeDoc(layoutDoc);
  layoutPresentation.dispose?.();
  edit.disposeDoc(editor.doc);
}
