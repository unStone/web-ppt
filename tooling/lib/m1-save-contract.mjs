import { diffPackageBytes } from '../diff-package.mjs';
import { equalBytes } from './bytes.mjs';
import { localRecords } from './zip-records.mjs';
const emu = (value) => String(Math.round(value * 9525));

function replaceOnce(source, before, after) {
  const at = source.indexOf(before);
  if (at < 0 || source.indexOf(before, at + before.length) >= 0) {
    throw new Error(`M1 固件中的预期片段不唯一：${before}`);
  }
  return source.slice(0, at) + after + source.slice(at + before.length);
}

function findNamed(elements, name) {
  for (const element of elements) {
    if (element.name === name) return element;
    if (element.kind === 'group') {
      const nested = findNamed(element.children, name);
      if (nested) return nested;
    }
  }
  return null;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** M1 的独立验收合约；预期值来自输入文件与方案，不读取保存器内部状态。 */
export async function runM1SaveContract({
  core, edit, fixtureNames, load, check, eq, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ M1 最小写回与保存幂等\x1b[0m');

  const names = fixtureNames.filter((name) => name.endsWith('.pptx') && !name.includes('encrypted'));
  let identityFiles = 0;
  for (const name of names) {
    const input = load(name);
    const pres = await core.parse(input, { edit: true, keepPackage: true, lazy: false, assets: 'defer' });
    const doc = edit.createDoc(pres, { idPrefix: `m1-${identityFiles}-` });
    const editor = new edit.Editor(doc);
    const result = await editor.saveDetailed();
    if (result.mode === 'identity' && result.bytes === doc.package.bytes
      && equalBytes(result.bytes, input) && !editor.isDirty()) identityFiles++;
    edit.disposeDoc(doc);
  }
  check('全部可编辑 pptx 无编辑保存保持原文件逐字节身份', identityFiles === names.length,
    `${identityFiles}/${names.length}`);
  console.log(`  ${identityFiles}/${names.length} 份 pptx 无编辑保存逐字节相同`);

  const scenario = Object.freeze({
    file: 'sample-edit-xfrm.pptx', targetName: '异名前缀形状', x: 123.375,
  });
  const input = load(scenario.file);
  const pres = await core.parse(input, { edit: true, keepPackage: true, lazy: false, assets: 'defer' });
  const doc = edit.createDoc(pres, { idPrefix: 'm1-move-' });
  const editor = new edit.Editor(doc);
  const target = Object.values(doc.elements).find((record) => record.src.name === scenario.targetName);
  if (!check('单形状移动固件暴露稳定编辑锚点', !!target?.meta.origin)) {
    edit.disposeDoc(doc);
    return;
  }

  const sourcePart = target.meta.origin.part;
  const sourceXml = new TextDecoder().decode(doc.package.parts[sourcePart]);
  const x = scenario.x;
  const beforeOff = `<d:off x="${emu(80)}" y="${emu(90)}"/>`;
  const afterOff = `<d:off x="${emu(x)}" y="${emu(90)}"/>`;
  const expectedXml = replaceOnce(sourceXml, beforeOff, afterOff);
  editor.exec({ type: 'SetXfrm', id: target.id, x });
  const saved = await editor.saveDetailed();
  const artifactPath = saveArtifact('single-move.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  check('移动一个形状使用直通保存且只重写一个 ZIP 条目',
    saved.mode === 'passthrough' && saved.rewrittenEntries === 1 && saved.preservedEntries > 0);
  eq('移动一个形状只改变目标 slide part',
    JSON.stringify({ added: diff.added, removed: diff.removed, changed: diff.changed }),
    JSON.stringify({ added: [], removed: [], changed: [sourcePart] }));
  eq('目标 XML 只把自己的 off@x 改成指定 EMU',
    new TextDecoder().decode(saved.package.parts[sourcePart]), expectedXml);
  const beforeRecords = localRecords(input);
  const afterRecords = localRecords(saved.bytes);
  check('目标外全部 ZIP 本地头、extra 与原始压缩流逐字节直通',
    [...beforeRecords].every(([name, record]) => name === sourcePart
      || equalBytes(afterRecords.get(name), record))
    && !equalBytes(afterRecords.get(sourcePart), beforeRecords.get(sourcePart)));

  const reparsed = await core.parse(saved.bytes, { edit: true, lazy: false, assets: 'defer' });
  const projected = editor.toSlide(doc.slideOrder[0]);
  const comparable = structuredClone(reparsed.slides[0]);
  delete comparable.editInfo;
  const reparsedTarget = findNamed(comparable.elements, target.src.name);
  const projectedTarget = findNamed(projected.elements, target.src.name);
  check('重新解析的移动坐标与有效投影误差不超过一个 EMU',
    Math.abs(reparsedTarget.x - projectedTarget.x) <= 1 / 9525);
  reparsedTarget.x = projectedTarget.x;
  eq('保存产物重新解析后的统一投影逐字段等于 EditDoc 有效投影',
    stableJson(comparable), stableJson(projected));
  const projectedFingerprint = renderFingerprint(scenario.file, 'projected', scenario);
  const savedFingerprint = renderFingerprint(artifactPath, 'saved', scenario);
  for (const textMode of ['html', 'svg']) {
    eq(`保存产物 ${textMode} 渲染指纹等于独立进程中的有效投影`,
      savedFingerprint[textMode], projectedFingerprint[textMode]);
  }

  const repeated = await editor.saveDetailed();
  check('相同状态重复保存保持 ZIP 字节与包句柄身份', repeated.mode === 'identity'
    && repeated.bytes === saved.bytes && repeated.package === saved.package && !editor.isDirty());
  reparsed.dispose?.();
  edit.disposeDoc(doc);

  const deleteScenario = Object.freeze({
    type: 'remove', file: 'sample-editor-delete.pptx', targetName: 'delete-peer',
  });
  const deleteInput = load(deleteScenario.file);
  const deletePres = await core.parse(deleteInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const deleteDoc = edit.createDoc(deletePres, { idPrefix: 'm1-delete-' });
  const deleteEditor = new edit.Editor(deleteDoc);
  const deleteTarget = Object.values(deleteDoc.elements)
    .find((record) => record.src.name === deleteScenario.targetName);
  if (!check('元素删除指纹固件暴露稳定编辑锚点', !!deleteTarget?.meta.origin)) {
    edit.disposeDoc(deleteDoc);
    return;
  }
  deleteEditor.exec({ type: 'RemoveElement', id: deleteTarget.id });
  const deleteSaved = await deleteEditor.saveDetailed();
  const deleteArtifact = saveArtifact('element-delete.pptx', deleteSaved.bytes);
  const deleteReparsed = await core.parse(deleteSaved.bytes, { lazy: false, assets: 'defer' });
  check('元素删除保存后重新解析不再包含目标',
    !findNamed(deleteReparsed.slides[0].elements, deleteScenario.targetName));
  const deleteProjectedFingerprint = renderFingerprint(
    deleteScenario.file, 'projected', deleteScenario,
  );
  const deleteSavedFingerprint = renderFingerprint(deleteArtifact, 'saved', deleteScenario);
  for (const textMode of ['html', 'svg']) {
    eq(`元素删除保存产物 ${textMode} 指纹等于独立进程中的有效投影`,
      deleteSavedFingerprint[textMode], deleteProjectedFingerprint[textMode]);
  }
  deleteReparsed.dispose?.();
  edit.disposeDoc(deleteDoc);

  const layerScenario = Object.freeze({
    type: 'order', file: 'sample-editor-layer.pptx', targetName: 'layer-back', to: 'front',
  });
  const layerInput = load(layerScenario.file);
  const layerPres = await core.parse(layerInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const layerDoc = edit.createDoc(layerPres, { idPrefix: 'm1-layer-' });
  const layerEditor = new edit.Editor(layerDoc);
  const layerTarget = Object.values(layerDoc.elements)
    .find((record) => record.src.name === layerScenario.targetName);
  if (!check('元素层级指纹固件暴露稳定编辑锚点', !!layerTarget?.meta.origin)) {
    edit.disposeDoc(layerDoc);
    return;
  }
  layerEditor.exec({ type: 'SetZ', id: layerTarget.id, to: layerScenario.to });
  const layerSaved = await layerEditor.saveDetailed();
  const layerArtifact = saveArtifact('element-layer.pptx', layerSaved.bytes);
  const layerDiff = diffPackageBytes(layerInput, layerSaved.bytes);
  const layerReparsed = await core.parse(layerSaved.bytes, { lazy: false, assets: 'defer' });
  check('元素层级保存只改目标页且重新解析后目标位于可写顶层末端',
    layerSaved.mode === 'passthrough' && layerSaved.rewrittenEntries === 1
      && layerDiff.changed.join(',') === layerTarget.meta.origin.part
      && layerReparsed.slides[0].elements.at(-1)?.name === layerScenario.targetName);
  const layerProjectedFingerprint = renderFingerprint(
    layerScenario.file, 'projected', layerScenario,
  );
  const layerSavedFingerprint = renderFingerprint(layerArtifact, 'saved', layerScenario);
  for (const textMode of ['html', 'svg']) {
    eq(`元素层级保存产物 ${textMode} 指纹等于独立进程中的有效投影`,
      layerSavedFingerprint[textMode], layerProjectedFingerprint[textMode]);
  }
  layerReparsed.dispose?.();
  edit.disposeDoc(layerDoc);

  const alignScenario = Object.freeze({
    type: 'align', file: 'sample-editor-align.pptx', targetName: 'align-plain',
    targetNames: ['align-plain', 'align-rotated', 'align-frame'], edge: 'left',
  });
  const alignInput = load(alignScenario.file);
  const alignPres = await core.parse(alignInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const alignDoc = edit.createDoc(alignPres, { idPrefix: 'm1-align-' });
  const alignEditor = new edit.Editor(alignDoc);
  const alignTargets = alignScenario.targetNames.map((name) => Object.values(alignDoc.elements)
    .find((record) => record.src.name === name));
  if (!check('元素对齐指纹固件暴露普通、旋转与 frame 写回锚点',
    alignTargets.every((record) => !!record?.meta.origin))) {
    edit.disposeDoc(alignDoc);
    return;
  }
  const alignPart = alignTargets[0].meta.origin.part;
  const alignSourcePart = alignDoc.package.parts[alignPart].slice();
  alignEditor.exec({
    type: 'AlignElements', ids: alignTargets.map((record) => record.id), edge: alignScenario.edge,
  });
  const alignSaved = await alignEditor.saveDetailed();
  const alignArtifact = saveArtifact('element-align.pptx', alignSaved.bytes);
  const alignDiff = diffPackageBytes(alignInput, alignSaved.bytes);
  const alignReparsed = await core.parse(alignSaved.bytes, { lazy: false, assets: 'defer' });
  const alignReparsedDoc = edit.createDoc(alignReparsed, { idPrefix: 'm1-align-reopen-' });
  const reopenedBounds = alignScenario.targetNames.map((name) => {
    const record = Object.values(alignReparsedDoc.elements).find((candidate) => candidate.src.name === name);
    const element = edit.effectiveElement(alignReparsedDoc, record.id);
    const points = [
      { x: 0, y: 0 }, { x: element.w, y: 0 },
      { x: element.w, y: element.h }, { x: 0, y: element.h },
    ].map((point) => edit.elementFrameToSlidePoint(alignReparsedDoc, record.id, point));
    return Math.min(...points.map((point) => point.x));
  });
  check('元素对齐保存只改目标页且重开后的视觉左边误差不超过一个 EMU',
    alignSaved.mode === 'passthrough' && alignSaved.rewrittenEntries === 1
      && alignDiff.changed.join(',') === alignPart
      && Math.max(...reopenedBounds.map((left) => Math.abs(left - reopenedBounds[0]))) <= 1 / 9525);
  const alignProjectedFingerprint = renderFingerprint(
    alignScenario.file, 'projected', alignScenario,
  );
  const alignSavedFingerprint = renderFingerprint(alignArtifact, 'saved', alignScenario);
  for (const textMode of ['html', 'svg']) {
    eq(`元素对齐保存产物 ${textMode} 指纹等于独立进程中的有效投影`,
      alignSavedFingerprint[textMode], alignProjectedFingerprint[textMode]);
  }
  alignEditor.undo();
  const alignRestored = await alignEditor.saveDetailed();
  check('对齐保存后撤销从首次触碰基线恢复原 slide part',
    equalBytes(alignRestored.package.parts[alignPart], alignSourcePart) && !alignEditor.isDirty());
  edit.disposeDoc(alignReparsedDoc);
  edit.disposeDoc(alignDoc);

  const clipboardScenario = Object.freeze({
    type: 'clipboard', file: 'sample-editor-layer.pptx', sourceFile: 'sample-editor-delete.pptx',
    targetName: 'delete-picture', x: 760, y: 80,
  });
  const clipboardInput = load(clipboardScenario.file);
  const clipboardSourcePres = await core.parse(load(clipboardScenario.sourceFile), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const clipboardTargetPres = await core.parse(clipboardInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const clipboardSourceDoc = edit.createDoc(clipboardSourcePres, { idPrefix: 'm1-clipboard-source-' });
  const clipboardDoc = edit.createDoc(clipboardTargetPres, { idPrefix: 'm1-clipboard-target-' });
  const clipboardTarget = Object.values(clipboardSourceDoc.elements)
    .find((record) => record.src.name === clipboardScenario.targetName);
  if (!check('元素剪贴板指纹固件暴露图片与来源关系', !!clipboardTarget?.meta.origin)) {
    edit.disposeDoc(clipboardDoc);
    edit.disposeDoc(clipboardSourceDoc);
    return;
  }
  const clipboardEditor = new edit.Editor(clipboardDoc);
  clipboardEditor.exec({
    type: 'PasteElements', payload: edit.copyElements(clipboardSourceDoc, [clipboardTarget.id]),
    at: {
      parentId: clipboardDoc.slideOrder[0], x: clipboardScenario.x, y: clipboardScenario.y,
    },
  });
  const clipboardSaved = await clipboardEditor.saveDetailed();
  const clipboardArtifact = saveArtifact('element-clipboard.pptx', clipboardSaved.bytes);
  const clipboardDiff = diffPackageBytes(clipboardInput, clipboardSaved.bytes);
  const clipboardReparsed = await core.parse(clipboardSaved.bytes, { lazy: false, assets: 'defer' });
  check('跨文档图片粘贴只新增媒体并改目标页、关系与 Content Types',
    clipboardSaved.mode === 'passthrough'
      && clipboardDiff.added.join(',') === 'ppt/media/image1.png'
      && clipboardDiff.removed.length === 0
      && clipboardDiff.changed.join(',') === [
        '[Content_Types].xml', 'ppt/slides/_rels/slide1.xml.rels', 'ppt/slides/slide1.xml',
      ].join(',')
      && findNamed(clipboardReparsed.slides[0].elements, clipboardScenario.targetName)?.kind === 'image');
  const clipboardProjectedFingerprint = renderFingerprint(
    clipboardScenario.file, 'projected', clipboardScenario,
  );
  const clipboardSavedFingerprint = renderFingerprint(
    clipboardArtifact, 'saved', clipboardScenario,
  );
  for (const textMode of ['html', 'svg']) {
    eq(`元素剪贴板保存产物 ${textMode} 指纹等于独立进程中的有效投影`,
      clipboardSavedFingerprint[textMode], clipboardProjectedFingerprint[textMode]);
  }
  clipboardReparsed.dispose?.();
  edit.disposeDoc(clipboardDoc);
  edit.disposeDoc(clipboardSourceDoc);

  const textScenario = Object.freeze({
    type: 'text', file: 'sample-editor-text.pptx', targetName: '文本综合',
    edits: [
      {
        targetName: '文本综合',
        ops: [
          {
            type: 'replace', from: { p: 0, r: 1, off: 0 },
            to: { p: 0, r: 1, off: 2 }, text: '纯 Web',
          },
          { type: 'splitParagraph', at: { p: 1, r: 0, off: 5 } },
        ],
      },
      {
        targetName: '空文本框',
        ops: [{
          type: 'replace', from: { p: 0, r: 0, off: 0 },
          to: { p: 0, r: 0, off: 0 }, text: '从空白开始编辑',
        }],
      },
    ],
    formats: [
      {
        targetName: '重复格式',
        range: { from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 2, off: 1 } },
        props: { font: 'Noto Sans', size: 31.2, b: true, i: true, u: true, strike: true },
      },
      {
        targetName: '文本综合',
        // 上面的拆段会把字段段落从 p4 移到 p5。
        range: { from: { p: 5, r: 0, off: 0 }, to: { p: 5, r: 0, off: 1 } },
        props: { b: true, size: 28 },
      },
      {
        targetName: '文本综合',
        // 跨过拆段后的空 p3，验证 endParaRPr 与普通 run 共用同一格式语义。
        range: { from: { p: 2, r: 0, off: 0 }, to: { p: 4, r: 0, off: 1 } },
        props: { u: true },
      },
    ],
    paragraphFormats: [
      {
        targetName: '段落格式',
        range: { from: { p: 0, r: 0, off: 1 }, to: { p: 2, r: 0, off: 0 } },
        props: {
          align: 'left', lineHeight: 2.1, spaceBefore: 14, spaceAfter: 7,
          marginLeft: 30, indent: -12,
        },
      },
      {
        targetName: '文本综合',
        range: { from: { p: 0, r: 0, off: 1 }, to: { p: 0, r: 0, off: 1 } },
        // bodyPr 有 8% 行距压缩；有效 1.72 写回后应成为 150% 单倍行距。
        props: { lineHeight: 1.72 },
      },
      {
        targetName: '文本综合',
        // 覆盖 Enter 新拆出的共享来源段、空段、公式与字段，验证重建路径逐段克隆 pPr。
        range: { from: { p: 1, r: 0, off: 1 }, to: { p: 5, r: 0, off: 1 } },
        props: { spaceAfter: 11, marginLeft: 19 },
      },
    ],
  });
  const textInput = load(textScenario.file);
  const textPres = await core.parse(textInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const textDoc = edit.createDoc(textPres, { idPrefix: 'm1-text-' });
  const textEditor = new edit.Editor(textDoc);
  const textTargets = [...textScenario.edits, ...textScenario.formats, ...textScenario.paragraphFormats]
    .map((change) => Object.values(textDoc.elements)
      .find((record) => record.src.name === change.targetName));
  if (!check('文字指纹固件暴露复杂文本与空文本框写回锚点',
    textTargets.every((record) => !!record?.meta.origin))) {
    edit.disposeDoc(textDoc);
    return;
  }
  textScenario.edits.forEach((change) => {
    const target = Object.values(textDoc.elements)
      .find((record) => record.src.name === change.targetName);
    textEditor.exec({ type: 'EditText', id: target.id, ops: change.ops });
  });
  textScenario.formats.forEach((change) => {
    const target = Object.values(textDoc.elements)
      .find((record) => record.src.name === change.targetName);
    textEditor.exec({
      type: 'SetRunProps', id: target.id, range: change.range, props: change.props,
    });
  });
  textScenario.paragraphFormats.forEach((change) => {
    const target = Object.values(textDoc.elements)
      .find((record) => record.src.name === change.targetName);
    textEditor.exec({
      type: 'SetParaProps', id: target.id, range: change.range, props: change.props,
    });
  });
  const textSaved = await textEditor.saveDetailed();
  const textArtifact = saveArtifact('basic-text-editing.pptx', textSaved.bytes);
  const textDiff = diffPackageBytes(textInput, textSaved.bytes);
  const textReparsed = await core.parse(textSaved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedRich = findNamed(textReparsed.slides[0].elements, '文本综合');
  const reopenedEmpty = findNamed(textReparsed.slides[0].elements, '空文本框');
  const reopenedRepeated = findNamed(textReparsed.slides[0].elements, '重复格式');
  const reopenedParagraphs = findNamed(textReparsed.slides[0].elements, '段落格式');
  const slideXml = new TextDecoder().decode(textReparsed.package.parts['ppt/slides/slide1.xml']);
  check('文字保存只改目标页并保留拆段 RTL、公式、字段、字符格式和空文本框继承格式',
    textSaved.mode === 'passthrough' && textDiff.changed.join(',') === 'ppt/slides/slide1.xml'
      && reopenedRich.text.paragraphs.slice(1, 3).every((paragraph) => paragraph.rtl)
      && reopenedRich.text.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.math?.length))
      && reopenedRich.text.paragraphs[3].runs[0].u
      && Math.abs(reopenedRich.text.paragraphs[0].lineHeight - 1.72) < 1e-9
      && reopenedRich.text.paragraphs.slice(1).every((paragraph) =>
        paragraph.spaceAfter === 11 && paragraph.marL === 19)
      && reopenedRich.text.paragraphs[5].runs[0].b
      && reopenedRich.text.paragraphs[5].runs[0].size === 28
      && reopenedRepeated.text.paragraphs[0].runs.every((run) => run.fonts[0] === 'Noto Sans'
        && Math.abs(run.size - 31.2) < 1e-9 && run.b && run.i && run.u && run.strike)
      && reopenedEmpty.text.paragraphs[0].runs[0].b === true
      && reopenedEmpty.text.paragraphs[0].runs.map((run) => run.text).join('') === '从空白开始编辑'
      && reopenedParagraphs.text.paragraphs.slice(0, 3).every((paragraph) => paragraph.align === 'left'
        && paragraph.lineHeight === 2.1 && paragraph.spaceBefore === 14
        && paragraph.spaceAfter === 7 && paragraph.marL === 30 && paragraph.indent === -12)
      && reopenedParagraphs.text.paragraphs[3].align === 'right'
      && slideXml.includes('<a:fld')
      && slideXml.includes('<?format keep?>') && slideXml.includes('<!--paragraph-format-sentinel-->')
      && slideXml.includes('<?paragraph  keep = "yes"?>')
      && slideXml.includes('<!--paragraph-props:  keep-->')
      && slideXml.includes('<!--unselected-ppr:  keep-->')
      && slideXml.includes('<?unselected-ppr  keep = "yes"?>')
      && slideXml.includes('x:keep="spacing"')
      && slideXml.includes('<a:spcPct val="150000"')
      && (slideXml.match(/typeface="Noto Sans"/g) ?? []).length === 9);
  const textProjectedFingerprint = renderFingerprint(textScenario.file, 'projected', textScenario);
  const textSavedFingerprint = renderFingerprint(textArtifact, 'saved', textScenario);
  for (const textMode of ['html', 'svg']) {
    eq(`文字保存产物 ${textMode} 指纹等于独立进程中的有效投影`,
      textSavedFingerprint[textMode], textProjectedFingerprint[textMode]);
  }
  textReparsed.dispose?.();
  edit.disposeDoc(textDoc);
}
