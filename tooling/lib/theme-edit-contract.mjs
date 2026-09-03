const fillColor = (element) => element?.fill?.type === 'solid' ? element.fill.color : null;

/** 主题只经公开目录、命令与有效投影 seam 验收，不读取内部重解析缓存。 */
export async function runThemeEditContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ Theme 目录、命令与依赖传播\x1b[0m');
  const input = load('sample-editor-theme.pptx');
  if (!check('找到多主题确定性固件', !!input)) return;
  const viewOnly = await core.parse(input, { lazy: false, assets: 'defer' });
  check('未开启 edit 时不常驻主题目录', viewOnly.editInfo === undefined);
  viewOnly.dispose();
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'theme-edit-' });
  const editor = new edit.Editor(doc);
  const themes = edit.listThemes(doc);
  const source = themes.find((theme) => theme.name === 'Add Slide Theme');
  const other = themes.find((theme) => theme.name === 'Target Layout Theme');
  check('编辑解析公开两个 OPC 主题及其来源方案', themes.length === 2
    && Object.keys(source?.colors ?? {}).length === 12
    && source?.colors.accent1 === 'rgb(217,79,112)'
    && source?.fonts.minor.latin === 'Calibri'
    && other?.colors.accent1 === 'rgb(0,153,204)'
    && source?.direct === false && other?.direct === false);
  if (!source || !other) return;

  const sourceSlide = doc.slideOrder[0];
  const otherLayout = doc.layoutOrder.find((id) => doc.layouts[id].themeId === other.id);
  const inserted = editor.exec({ type: 'AddSlide', layoutId: otherLayout, at: { after: sourceSlide } });
  const otherSlide = [...inserted.createdSlides][0];
  const otherProjection = editor.toSlide(otherSlide);
  const sourceShape = Object.values(doc.elements).find((record) =>
    record.parent === sourceSlide && record.src.name === '普通业务形状');
  const styleReference = Object.values(doc.elements).find((record) =>
    record.parent === sourceSlide && record.src.name === '主题样式引用');
  const directShape = Object.values(doc.elements).find((record) =>
    record.parent === sourceSlide && record.src.name === '页面直接格式');
  if (!check('找到主题色与主题字体来源形状', !!sourceShape)) return;
  if (!check('找到主题样式引用与页面直接格式形状', !!styleReference && !!directShape)) return;
  const originalTheme = presentation.package.parts[source.id].slice();
  const otherTheme = presentation.package.parts[other.id].slice();

  const result = editor.exec({
    type: 'SetTheme', id: source.id,
    clrScheme: { accent1: '#112233' },
    fontScheme: { minor: { latin: 'Theme Edited Latin' } },
  });
  const projected = editor.effectiveElement(sourceShape.id);
  const state = edit.queryTheme(doc, source.id);
  check('SetTheme 以字段级 Patch 更新主题并整页重算依赖分支',
    result.forward.length === 2
      && result.forward.every((patch) => patch.path[0] === 'themes')
      && result.dirtySlides.has(sourceSlide) && result.renderSlides.has(sourceSlide)
      && !result.dirtySlides.has(otherSlide)
      && fillColor(projected) === 'rgb(17,34,51)'
      && projected.text?.paragraphs[0].runs[0].fonts[0] === 'Theme Edited Latin'
      && fillColor(editor.effectiveElement(styleReference.id)) === 'rgb(17,34,51)'
      && fillColor(editor.effectiveElement(directShape.id)) === 'rgb(68,85,102)'
      && editor.effectiveElement(directShape.id).text?.paragraphs[0].runs[0].fonts[0] === 'Direct Typeface'
      && state.colors.accent1 === 'rgb(17,34,51)'
      && state.fonts.minor.latin === 'Theme Edited Latin'
      && state.direct === true);
  check('无关主题页面保持投影缓存身份', editor.toSlide(otherSlide) === otherProjection);

  const editedBytes = await editor.save();
  const reopenedPresentation = await core.parse(editedBytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopened = edit.createDoc(reopenedPresentation, { idPrefix: 'theme-reopen-' });
  const reopenedTheme = edit.queryTheme(reopened, source.id);
  const reopenedShape = Object.values(reopened.elements).find((record) =>
    record.src.name === '普通业务形状');
  check('保存重开与即时投影主题语义一致且只改目标 part',
    reopenedTheme.colors.accent1 === 'rgb(17,34,51)'
      && reopenedTheme.fonts.minor.latin === 'Theme Edited Latin'
      && fillColor(edit.effectiveElement(reopened, reopenedShape.id)) === 'rgb(17,34,51)'
      && new TextDecoder().decode(reopened.package.parts[source.id]).includes('data-keep="theme-source"')
      && Buffer.compare(Buffer.from(reopened.package.parts[other.id]), Buffer.from(otherTheme)) === 0);
  edit.disposeDoc(reopened);

  const resetFields = editor.exec({
    type: 'SetTheme', id: source.id,
    clrScheme: { accent1: null }, fontScheme: { minor: { latin: null } },
  });
  const resetState = edit.queryTheme(doc, source.id);
  check('字段级 null 恢复来源并清理稀疏覆盖',
    resetFields.forward.length === 2
      && resetState.colors.accent1 === 'rgb(217,79,112)'
      && resetState.fonts.minor.latin === 'Calibri'
      && resetState.direct === false);
  editor.undo();
  editor.undo();
  const restored = edit.queryTheme(doc, source.id);
  check('撤销恢复来源主题且移除稀疏覆盖',
    restored.colors.accent1 === 'rgb(217,79,112)'
      && restored.fonts.minor.latin === 'Calibri'
      && restored.direct === false
      && fillColor(editor.effectiveElement(sourceShape.id)) === 'rgb(217,79,112)');
  const restoredBytes = await editor.save();
  const restoredPresentation = await core.parse(restoredBytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  check('撤销至来源后主题 part 恢复逐字节直通',
    Buffer.compare(Buffer.from(restoredPresentation.package.parts[source.id]), Buffer.from(originalTheme)) === 0);
  restoredPresentation.dispose();
  edit.disposeDoc(doc);

  const dependencyPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const dependencyDoc = edit.createDoc(dependencyPresentation, { idPrefix: 'theme-dependency-' });
  const dependencyEditor = new edit.Editor(dependencyDoc);
  const dependencyTheme = edit.listThemes(dependencyDoc)[0];
  const dependencySource = dependencyDoc.slideOrder[0];
  const sourceLayout = dependencyDoc.slides[dependencySource].layoutId;
  const targetLayout = dependencyDoc.layoutOrder.find((id) =>
    dependencyDoc.layouts[id].themeId !== dependencyTheme.id);
  dependencyEditor.exec({ type: 'SetTheme', id: dependencyTheme.id, clrScheme: { accent2: '#102030' } });
  dependencyEditor.undo(); // 首次主题命令已经建立反向索引。
  const added = dependencyEditor.exec({ type: 'AddSlide', layoutId: sourceLayout, at: { after: dependencySource } });
  const addedId = [...added.createdSlides][0];
  const afterAdd = dependencyEditor.exec({
    type: 'SetTheme', id: dependencyTheme.id, clrScheme: { accent2: '#203040' },
  });
  check('AddSlide 增量加入主题反向依赖',
    afterAdd.dirtySlides.has(dependencySource) && afterAdd.dirtySlides.has(addedId));
  dependencyEditor.exec({ type: 'SetLayout', id: addedId, layoutId: targetLayout });
  const afterLayout = dependencyEditor.exec({
    type: 'SetTheme', id: dependencyTheme.id, clrScheme: { accent2: '#304050' },
  });
  check('SetLayout 增量迁移主题反向依赖',
    afterLayout.dirtySlides.has(dependencySource) && !afterLayout.dirtySlides.has(addedId));
  dependencyEditor.exec({ type: 'RemoveSlide', id: dependencySource });
  const afterRemove = dependencyEditor.exec({
    type: 'SetTheme', id: dependencyTheme.id, clrScheme: { accent2: '#405060' },
  });
  check('RemoveSlide 增量移除主题反向依赖', afterRemove.dirtySlides.size === 0);
  edit.disposeDoc(dependencyDoc);

  const recoveryFrames = [];
  const recoveryPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const recoveryDoc = edit.createDoc(recoveryPresentation, { idPrefix: 'theme-recovery-' });
  const recoveryEditor = new edit.Editor(recoveryDoc);
  recoveryEditor.subscribeRecovery((frame) => recoveryFrames.push(frame));
  const recoveryTheme = edit.listThemes(recoveryDoc)[0];
  recoveryEditor.exec({
    type: 'SetTheme', id: recoveryTheme.id,
    clrScheme: { accent3: '#506070' }, fontScheme: { major: { latin: 'Recovered Theme' } },
  });
  const replayPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const replayDoc = edit.createDoc(replayPresentation, { idPrefix: 'theme-recovery-' });
  const replayEditor = new edit.Editor(replayDoc, { recoveryFrames });
  const replayed = edit.queryTheme(replayDoc, recoveryTheme.id);
  check('字段级主题 Patch 可序列化恢复',
    replayed.colors.accent3 === 'rgb(80,96,112)'
      && replayed.fonts.major.latin === 'Recovered Theme');
  void replayEditor;
  edit.disposeDoc(recoveryDoc);
  edit.disposeDoc(replayDoc);
}
