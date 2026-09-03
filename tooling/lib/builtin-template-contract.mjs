import { equalBytes } from './bytes.mjs';

const EXPECTED_LAYOUTS = ['标题页', '标题和内容', '双内容', '章节页', '空白'];
const solid = (fill) => fill?.type === 'solid' ? fill.color : null;
const rgb = (hex) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${value >> 16},${(value >> 8) & 255},${value & 255})`;
};

/** 内置模板只从独立公开入口观察，避免测试与配方实现共享真值。 */
export async function runBuiltinTemplateContract({
  templates, generate, core, edit, check, sha256, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ 内置模板目录与确定性生成\x1b[0m');
  const catalog = templates.listBuiltinTemplates?.();
  check('独立入口公开三套稳定模板与生成函数',
    typeof templates.createPptxFromTemplate === 'function'
      && JSON.stringify(catalog?.map(({ id, name }) => ({ id, name }))) === JSON.stringify([
        { id: 'aurora', name: '极光' },
        { id: 'editorial', name: '刊页' },
        { id: 'midnight', name: '夜幕' },
      ]));
  if (!catalog) return;
  check('模板预览是冻结的轻量纯数据 token', Object.isFrozen(catalog)
    && catalog.every((template) => Object.isFrozen(template) && Object.isFrozen(template.preview)
      && /^#[0-9A-F]{6}$/i.test(template.preview.surface)
      && /^#[0-9A-F]{6}$/i.test(template.preview.foreground)
      && /^#[0-9A-F]{6}$/i.test(template.preview.accent)
      && /^#[0-9A-F]{6}$/i.test(template.preview.secondary)));
  check('未知模板 id 在生成前被拒绝', (() => {
    try { templates.createPptxFromTemplate('missing'); return false; } catch { return true; }
  })() && (() => {
    try { templates.createPptxFromTemplate('__proto__'); return false; } catch { return true; }
  })());

  const fingerprints = [];
  const visualSignatures = [];
  for (const template of catalog) {
    const first = templates.createPptxFromTemplate(template.id);
    const second = templates.createPptxFromTemplate(template.id);
    fingerprints.push(sha256(first));
    check(`${template.name}连续生成逐字节一致`, equalBytes(first, second));
    const presentation = await core.parse(first, {
      edit: true, keepPackage: true, lazy: false, assets: 'defer',
    });
    const doc = edit.createDoc(presentation, { idPrefix: `${template.id}-` });
    const templateTheme = edit.queryTheme(doc, edit.listThemes(doc)[0].id);
    const previewColors = [
      template.preview.surface, template.preview.foreground,
      template.preview.accent, template.preview.secondary,
    ].map(rgb);
    check(`${template.name}预览色全部来自物化主题`, previewColors.every((color) =>
      Object.values(templateTheme.colors).includes(color)));
    check(`${template.name}物化自洽主题、母版、五种版式与标题页`,
      presentation.width === 1280 && presentation.height === 720
        && edit.listThemes(doc)[0]?.name === template.name
        && edit.listMasters(doc).length === 1
        && JSON.stringify(edit.listLayouts(doc).map(({ name }) => name))
          === JSON.stringify(EXPECTED_LAYOUTS)
        && doc.slideOrder.length === 1
        && doc.layouts[doc.slides[doc.slideOrder[0]].layoutId]?.name === '标题页'
        && doc.slides[doc.slideOrder[0]].children.map((id) => doc.elements[id])
          .filter((record) => ['ctrTitle', 'title', 'subTitle'].includes(record.meta.ph?.type))
          .every((record) => record.meta.editable === 'full')
        && doc.slides[doc.slideOrder[0]].children.map((id) => doc.elements[id])
          .filter((record) => ['ctrTitle', 'title', 'subTitle'].includes(record.meta.ph?.type)).length === 2);
    const editor = new edit.Editor(doc);
    const templateMaster = edit.listMasters(doc)[0];
    const masterCanvas = editor.toDesignCanvas(templateMaster.target);
    const masterColors = masterCanvas.elements.map(({ fill, stroke }) => [solid(fill), stroke?.color]);
    visualSignatures.push(JSON.stringify({
      background: solid(masterCanvas.background), colors: masterColors,
    }));
    check(`${template.name}母版背景与预览表面色一致`,
      solid(masterCanvas.background) === rgb(template.preview.surface));
    let after = doc.slideOrder[0];
    const addedLayouts = [];
    for (const layout of edit.listLayouts(doc)) {
      const result = editor.exec({ type: 'AddSlide', layoutId: layout.id, at: { after } });
      after = [...result.createdSlides][0];
      addedLayouts.push(doc.layouts[doc.slides[after].layoutId].name);
    }
    check(`${template.name}的全部常用版式均可新增`,
      JSON.stringify(addedLayouts) === JSON.stringify(EXPECTED_LAYOUTS)
        && doc.slideOrder.length === EXPECTED_LAYOUTS.length + 1);
    edit.disposeDoc(doc);
  }
  check('三套模板生成物彼此不同', new Set(fingerprints).size === 3);
  check('三套模板的母版背景与装饰组合彼此不同', new Set(visualSignatures).size === 3);
  check('扩展模板生成器不改变既有空白文稿字节',
    sha256(generate.createBlankPptx()) === '1e8c6aeaa66725d7b498d783650f0b9f788e3b0722bc103379a82e02a8c1dbbf'
      && sha256(generate.createBlankPptx({ width: 960, height: 540 }))
        === '9ee9d314cac7c0d5713435b9d7280e0a3c3ee276bb8408b6c63771f259806051');

  const custom = await core.parse(templates.createPptxFromTemplate('aurora', {
    width: 960, height: 540,
  }), { lazy: false });
  check('模板页面尺寸可覆盖', custom.width === 960 && custom.height === 540);
  custom.dispose?.();

  const sourceBytes = templates.createPptxFromTemplate('aurora');
  const source = await core.parse(sourceBytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(source, { idPrefix: 'template-edit-' });
  const editor = new edit.Editor(doc);
  const theme = edit.listThemes(doc)[0];
  const master = edit.listMasters(doc)[0];
  const layout = edit.listLayouts(doc).find(({ name }) => name === '标题和内容');
  const marker = doc.masters[master.id].children.map((id) => doc.elements[id])
    .find(({ src }) => src.name === '极光主光晕');
  const markerBefore = solid(editor.effectiveElement(marker.id).fill);
  editor.exec({ type: 'SetTheme', id: theme.id, clrScheme: { accent1: '#112233' } });
  const markerAfter = solid(editor.effectiveElement(marker.id).fill);
  check('模板主题修改沿同一来源图传播到母版图形',
    markerBefore !== markerAfter && markerAfter?.includes('17,34,51'));
  editor.undo();
  const undone = edit.queryTheme(doc, theme.id).colors.accent1;
  editor.redo();
  check('模板主题编辑进入统一撤销重做历史',
    undone === theme.colors.accent1 && edit.queryTheme(doc, theme.id).colors.accent1 === 'rgb(17,34,51)');
  editor.execDesign(master.target, {
    type: 'SetBackground', target: master.target,
    fill: { type: 'solid', color: '#203040' },
  });
  editor.execDesign(master.target, {
    type: 'SetMasterTextStyle', target: master.target, category: 'body', level: 2,
    run: { font: 'Template Edited', size: 27 },
  });
  editor.execDesign(layout.target, {
    type: 'SetBackground', target: layout.target,
    fill: { type: 'solid', color: '#E9EEF5' },
  });
  const added = editor.exec({ type: 'AddSlide', layoutId: layout.id, at: { after: doc.slideOrder[0] } });
  const addedSlide = [...added.createdSlides][0];
  check('模板母版与版式继续使用公开设计画布并传播到新增页',
    solid(edit.queryMaster(doc, master.target).background.value) === 'rgb(32,48,64)'
      && edit.queryMaster(doc, master.target).textStyles.body[2].value.run.font === 'Template Edited'
      && solid(edit.queryLayout(doc, layout.target).background.value) === 'rgb(233,238,245)'
      && solid(editor.toSlide(addedSlide).background) === 'rgb(233,238,245)');
  const saved = await editor.save();
  const reopenedPresentation = await core.parse(saved, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopened = edit.createDoc(reopenedPresentation, { idPrefix: 'template-reopened-' });
  const reopenedTheme = edit.listThemes(reopened)[0];
  const reopenedMaster = edit.listMasters(reopened)[0];
  const reopenedLayout = edit.listLayouts(reopened).find(({ name }) => name === '标题和内容');
  check('模板编辑保存重开后保持主题、母版、版式与新增页',
    edit.queryTheme(reopened, reopenedTheme.id).colors.accent1 === 'rgb(17,34,51)'
      && solid(edit.queryMaster(reopened, reopenedMaster.target).background.value) === 'rgb(32,48,64)'
      && edit.queryMaster(reopened, reopenedMaster.target).textStyles.body[2].value.run.font
        === 'Template Edited'
      && solid(edit.queryLayout(reopened, reopenedLayout.target).background.value) === 'rgb(233,238,245)'
      && reopened.slideOrder.length === 2);
  edit.disposeDoc(reopened);

  const frames = [];
  const recoverySource = await core.parse(sourceBytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const recoveryDoc = edit.createDoc(recoverySource, { idPrefix: 'template-recovery-' });
  const recoveryEditor = new edit.Editor(recoveryDoc);
  recoveryEditor.subscribeRecovery((frame) => frames.push(frame));
  const recoveryTheme = edit.listThemes(recoveryDoc)[0];
  recoveryEditor.exec({
    type: 'SetTheme', id: recoveryTheme.id, fontScheme: { minor: { latin: 'Recovered Template' } },
  });
  const replaySource = await core.parse(sourceBytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const replayDoc = edit.createDoc(replaySource, { idPrefix: 'template-recovery-' });
  const replayEditor = new edit.Editor(replayDoc, { recoveryFrames: JSON.parse(JSON.stringify(frames)) });
  check('模板设计来源补丁可序列化恢复',
    edit.listThemes(replayDoc)[0].fonts.minor.latin === 'Recovered Template'
      && replayEditor.toSlide(replayDoc.slideOrder[0]).elements.length > 0);
  edit.disposeDoc(replayDoc);
  edit.disposeDoc(recoveryDoc);
  edit.disposeDoc(doc);

  const fingerprintSourcePath = saveArtifact('aurora-source.pptx', sourceBytes);
  const fingerprintPresentation = await core.parse(sourceBytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const fingerprintDoc = edit.createDoc(fingerprintPresentation, {
    idPrefix: 'template-fingerprint-',
  });
  const fingerprintEditor = new edit.Editor(fingerprintDoc);
  const title = fingerprintDoc.slides[fingerprintDoc.slideOrder[0]].children
    .map((id) => fingerprintDoc.elements[id]).find((record) => record.meta.ph?.type === 'ctrTitle');
  fingerprintEditor.exec({
    type: 'EditText', id: title.id,
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 },
      text: '内置模板可编辑',
    }],
  });
  const fingerprintSavedPath = saveArtifact('aurora-edited.pptx', await fingerprintEditor.save());
  edit.disposeDoc(fingerprintDoc);
  const projectedFingerprint = renderFingerprint(fingerprintSourcePath, 'projected');
  const savedFingerprint = renderFingerprint(fingerprintSavedPath, 'saved');
  for (const textMode of ['html', 'svg']) check(
    `模板保存前后 ${textMode} 文字路径独立进程指纹一致`,
    projectedFingerprint[textMode] === savedFingerprint[textMode],
    JSON.stringify({ projected: projectedFingerprint[textMode], saved: savedFingerprint[textMode] }),
  );
}
