import { equalBytes } from './bytes.mjs';

/** 生成保存只从公开入口和最终 PPTX 观察，不读取生成器内部状态。 */
export async function runGeneratedSaveContract({
  core, edit, generate, load, check, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ 生成式 PPTX 保存\x1b[0m');
  if (!check('公开按需生成入口', typeof generate.generateEditDoc === 'function')) return;

  const doc = edit.createEmptyDoc({ width: 1280, height: 720, idPrefix: 'generated-empty-' });
  const first = generate.generateEditDoc(doc);
  const second = generate.generateEditDoc(doc);
  check('同一空白 EditDoc 连续生成逐字节一致且不采用生成包',
    equalBytes(first.bytes, second.bytes) && doc.package === null);
  check('空白生成物闭包包含演示、主题、母版与版式', [
    '[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml',
    'ppt/_rels/presentation.xml.rels', 'ppt/theme/theme1.xml',
    'ppt/slideMasters/slideMaster1.xml', 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    'ppt/slideLayouts/slideLayout1.xml', 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
  ].every((part) => first.package.parts[part]?.length));

  const reopened = await core.parse(first.bytes, { edit: true, lazy: false, assets: 'defer' });
  check('空白生成物可由公开解析器重开并保持尺寸与页数', reopened.source === 'pptx'
    && reopened.width === 1280 && reopened.height === 720 && reopened.slides.length === 0);
  reopened.dispose?.();
  saveArtifact('generated-empty.pptx', first.bytes);

  const source = await core.parse(load('sample-generated-save.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const content = edit.createDoc(source, { idPrefix: 'generated-content-' });
  const editor = new edit.Editor(content);
  const slideId = content.slideOrder[0];
  const sourceKinds = edit.toSlide(content, slideId).elements.map((element) => element.kind).sort();
  check('生成固件同时覆盖形状、图片填充、页面图片背景、表格与备注',
    JSON.stringify(sourceKinds) === JSON.stringify(['image', 'image', 'shape', 'shape', 'shape', 'table'])
    && edit.toSlide(content, slideId).background?.type === 'image'
    && edit.querySlideNotes(content, [slideId]).value === '生成备注第一行\n生成备注第二行');
  source.dispose?.();
  check('来源原包释放后进入生成保存而非补丁路径', content.package?.disposed === true);
  const generated = generate.generateEditDoc(content);
  const editorGenerated = await editor.saveDetailed();
  const editorGeneratedAgain = await editor.saveDetailed();
  check('Editor.saveDetailed 自动选择生成路径且连续保存确定',
    equalBytes(editorGenerated.bytes, generated.bytes)
    && equalBytes(editorGeneratedAgain.bytes, generated.bytes)
    && content.package?.disposed === true && !editor.isDirty());
  const contentPath = saveArtifact('generated-content.pptx', generated.bytes);
  const contentReopened = await core.parse(generated.bytes, { lazy: false, assets: 'defer' });
  check('单页多元素与备注生成物可重开', contentReopened.slides.length === 1
    && contentReopened.slides[0].elements.some((element) => element.name === '生成形状')
    && contentReopened.slides[0].elements.some((element) => element.name === '生成形状'
      && element.link === 'https://example.com/generated'
      && element.kind === 'shape'
      && element.text?.paragraphs.some((paragraph) => paragraph.runs
        .some((run) => run.link === 'https://example.com/generated')))
    && contentReopened.slides[0].elements.some((element) => element.name === '生成图片填充'
      && element.kind === 'shape' && element.fill?.type === 'image')
    && contentReopened.slides[0].elements.some((element) => element.name === '生成自由形状'
      && element.kind === 'shape' && element.path?.includes('Q') && element.path.includes('A'))
    && contentReopened.slides[0].elements.some((element) => element.kind === 'image')
    && contentReopened.slides[0].elements.some((element) => element.name === '生成音频'
      && element.kind === 'image' && element.media?.kind === 'audio')
    && contentReopened.slides[0].elements.some((element) => element.kind === 'table')
    && contentReopened.slides[0].background?.type === 'image'
    && contentReopened.slides[0].notes === '生成备注第一行\n生成备注第二行');
  contentReopened.dispose?.();
  const before = renderFingerprint('sample-generated-save.pptx', 'projected');
  const after = renderFingerprint(contentPath, 'saved');
  check('生成前后两条文本路径的独立进程指纹一致', JSON.stringify(after) === JSON.stringify(before),
    `${JSON.stringify(before)} != ${JSON.stringify(after)}`);
  edit.disposeDoc(content);

  const legacySource = await core.parse(load('sample.ppt'), {
    edit: true, lazy: false, assets: 'defer',
  });
  const legacyDoc = edit.createDoc(legacySource, { idPrefix: 'generated-ppt-' });
  const legacySaved = await new edit.Editor(legacyDoc).saveDetailed();
  const legacyPath = saveArtifact('generated-ppt-source.pptx', legacySaved.bytes);
  const legacyReopened = await core.parse(legacySaved.bytes, { lazy: false, assets: 'defer' });
  check('.ppt EditDoc 自动另存为可重开的 PPTX', legacyDoc.meta.source === 'ppt'
    && legacyReopened.source === 'pptx'
    && legacyReopened.slides.length === legacySource.slides.length);
  legacyReopened.dispose?.();
  const legacyBefore = renderFingerprint('sample.ppt', 'projected');
  const legacyAfter = renderFingerprint(legacyPath, 'saved');
  check('.ppt 另存前后两条文本路径的独立进程指纹一致',
    JSON.stringify(legacyAfter) === JSON.stringify(legacyBefore),
    `${JSON.stringify(legacyBefore)} != ${JSON.stringify(legacyAfter)}`);
  edit.disposeDoc(legacyDoc);

  const hiddenSource = await core.parse(load('sample-hidden.ppt'), {
    edit: true, lazy: false, assets: 'defer',
  });
  const hiddenDoc = edit.createDoc(hiddenSource, { idPrefix: 'generated-hidden-' });
  const hiddenSaved = await new edit.Editor(hiddenDoc).saveDetailed();
  const hiddenReopened = await core.parse(hiddenSaved.bytes, { lazy: false, assets: 'defer' });
  check('.ppt 隐藏页语义进入生成包',
    JSON.stringify(hiddenReopened.slides.map((slide) => !!slide.hidden))
      === JSON.stringify(hiddenSource.slides.map((slide) => !!slide.hidden)));
  hiddenReopened.dispose?.();
  edit.disposeDoc(hiddenDoc);

  const groupSource = await core.parse(load('showcase.ppt'), {
    edit: true, lazy: false, assets: 'inline',
  });
  const groupDoc = edit.createDoc(groupSource, { idPrefix: 'generated-group-' });
  const sourceGroups = groupSource.slides.flatMap((slide) => slide.elements)
    .filter((element) => element.kind === 'group').length;
  const groupSaved = generate.generateEditDoc(groupDoc);
  const groupReopened = await core.parse(groupSaved.bytes, { lazy: false, assets: 'defer' });
  const reopenedGroups = groupReopened.slides.flatMap((slide) => slide.elements)
    .filter((element) => element.kind === 'group').length;
  check('.ppt 完整图文表格与组合树可生成并重开',
    groupReopened.slides.length === groupSource.slides.length
    && sourceGroups > 0 && reopenedGroups === sourceGroups,
    `${groupSource.slides.length}/${sourceGroups} != ${groupReopened.slides.length}/${reopenedGroups}`);
  groupReopened.dispose?.();
  edit.disposeDoc(groupDoc);
}
