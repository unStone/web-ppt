import { diffPackageBytes } from '../diff-package.mjs';

const textOf = (shape) => shape.text?.paragraphs
  .map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n') ?? '';

/** 新增形状保存只通过公开命令、包差异、重开与独立进程渲染取证。 */
export async function runAddShapeSaveContract({
  core, edit, load, check, eq, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ AddShape 保留型保存与重开\x1b[0m');
  const scenario = Object.freeze({
    type: 'addShape', file: 'sample-editor-add-shape.pptx', slideIndex: 0,
    preset: 'roundRect', rect: { x: 376, y: 188, w: 286, h: 154 }, text: '新增后可编辑',
  });
  const input = load(scenario.file);
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'add-shape-save-' });
  const editor = new edit.Editor(doc);
  const slideId = doc.slideOrder[scenario.slideIndex];
  editor.exec({ type: 'AddShape', slideId, preset: scenario.preset, rect: scenario.rect });
  const id = editor.selection.kind === 'elements' ? editor.selection.ids[0] : null;
  editor.exec({
    type: 'EditText', id,
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 }, text: scenario.text,
    }],
  });
  const projected = editor.effectiveElement(id);
  const saved = await editor.saveDetailed();
  const artifact = saveArtifact('add-shape.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  const xml = new TextDecoder().decode(saved.package.parts['ppt/slides/slide1.xml']);
  const extensionAt = xml.indexOf('{D5B74B20-3A34-4CB1-9B12-ADD-SHAPE}');
  const addedName = doc.elements[id].src.name;
  const addedAt = xml.indexOf(`name="${addedName}"`);
  const addedHost = xml.slice(xml.lastIndexOf('<p:sp>', addedAt), xml.indexOf('</p:sp>', addedAt) + 7);
  check('新增形状只重写目标 slide part，并在 spTree 尾部扩展之前插入合法宿主',
    saved.mode === 'passthrough' && saved.rewrittenEntries === 1
      && diff.added.length === 0 && diff.removed.length === 0
      && diff.changed.join(',') === 'ppt/slides/slide1.xml'
      && addedAt > 0 && extensionAt > addedAt
      && xml.indexOf('<fixture:keep', extensionAt) > extensionAt
      && addedHost.includes('<p:nvSpPr>') && addedHost.includes('<p:spPr>')
      && addedHost.includes('<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>')
      && addedHost.includes('<p:txBody>') && addedHost.includes(scenario.text));

  const reopened = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedShape = reopened.slides[scenario.slideIndex].elements.find((element) =>
    element.kind === 'shape' && element.name === addedName);
  check('保存重开恢复同一预设、矩形、默认视觉和已输入文字',
    reopenedShape?.kind === 'shape'
      && reopenedShape.editInfo?.geom?.preset === scenario.preset
      && reopenedShape.x === projected.x && reopenedShape.y === projected.y
      && reopenedShape.w === projected.w && reopenedShape.h === projected.h
      && JSON.stringify(reopenedShape.fill) === JSON.stringify(projected.fill)
      && JSON.stringify(reopenedShape.stroke) === JSON.stringify(projected.stroke)
      && textOf(reopenedShape) === scenario.text);

  const projectedFingerprint = renderFingerprint(scenario.file, 'projected', scenario);
  const savedFingerprint = renderFingerprint(artifact, 'saved', scenario);
  for (const mode of ['html', 'svg']) {
    eq(`新增形状保存产物 ${mode} 指纹等于独立进程有效投影`,
      savedFingerprint[mode], projectedFingerprint[mode]);
  }

  const savedAgain = await editor.saveDetailed();
  const secondXml = new TextDecoder().decode(savedAgain.package.parts['ppt/slides/slide1.xml']);
  check('连续保存从基线重建而不重复插入宿主',
    [...secondXml.matchAll(new RegExp(`name="${addedName}"`, 'g'))].length === 1
      && secondXml.indexOf(`name="${addedName}"`) < secondXml.indexOf('{D5B74B20-3A34-4CB1-9B12-ADD-SHAPE}'));

  editor.undo();
  editor.undo();
  const restored = await editor.saveDetailed();
  const restoredDiff = diffPackageBytes(input, restored.bytes);
  check('保存后撤销文字与新增结构可回到原始包内容', restoredDiff.changed.length === 0
    && restoredDiff.added.length === 0 && restoredDiff.removed.length === 0);
  reopened.dispose?.();
  edit.disposeDoc(doc);
}
