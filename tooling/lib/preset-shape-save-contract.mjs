import { diffPackageBytes } from '../diff-package.mjs';

const decoder = new TextDecoder();
const byName = (records, name) => Object.values(records)
  .find((record) => record.src.name === name);

/** 补丁与生成保存都必须把预设及调节值写成可被第三方读取的规范 DrawingML。 */
export async function runPresetShapeSaveContract({
  core, edit, generate, load, check, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ 预设形状保留型与生成式保存\x1b[0m');
  const input = load('sample-editor-preset-shape.pptx');
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'preset-shape-save-' });
  const editor = new edit.Editor(doc);
  const source = byName(doc.elements, 'preset-source');
  const custom = byName(doc.elements, 'preset-custom');
  editor.exec({ type: 'SetAdj', id: source.id, name: 'adj', value: 44_000 });
  editor.exec({ type: 'SetPreset', id: custom.id, preset: 'star5' });
  const projected = {
    source: editor.effectiveElement(source.id).path,
    custom: editor.effectiveElement(custom.id).path,
  };
  const saved = await editor.saveDetailed();
  const artifact = saveArtifact('preset-shape-editing.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  const part = source.meta.origin.part;
  const xml = decoder.decode(saved.package.parts[part]);
  check('预设几何补丁只重写目标 slide part 并规范序列化 prstGeom/avLst',
    diff.added.length === 0 && diff.removed.length === 0 && diff.changed.join(',') === part
      && /name="preset-source"[\s\S]*?<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 44000"\/><\/a:avLst><\/a:prstGeom>/.test(xml)
      && /name="preset-custom"[\s\S]*?<a:prstGeom prst="star5"><a:avLst\/><\/a:prstGeom>/.test(xml)
      && xml.includes('r:id="rIdPresetLink"') && xml.includes('<a:effectLst>'));
  const reopenedPresentation = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedDoc = edit.createDoc(reopenedPresentation, { idPrefix: 'preset-shape-reopen-' });
  const reopenedEditor = new edit.Editor(reopenedDoc);
  const reopenedSource = byName(reopenedDoc.elements, 'preset-source');
  const reopenedCustom = byName(reopenedDoc.elements, 'preset-custom');
  check('预设几何补丁保存重开后调节值、路径与立即投影一致',
    reopenedSource.meta.geom?.preset === 'roundRect' && reopenedSource.meta.geom.adj.adj === 44_000
      && reopenedCustom.meta.geom?.preset === 'star5'
      && Object.keys(reopenedCustom.meta.geom.adj).length === 0
      && reopenedEditor.effectiveElement(reopenedSource.id).path === projected.source
      && reopenedEditor.effectiveElement(reopenedCustom.id).path === projected.custom);
  const scenario = {
    type: 'presetShape', targetName: 'preset-source', adjustments: { adj: 44_000 },
    convertTargetName: 'preset-custom', convertPreset: 'star5',
  };
  const projectedFingerprint = renderFingerprint(
    'sample-editor-preset-shape.pptx', 'projected', scenario,
  );
  const savedFingerprint = renderFingerprint(artifact, 'saved', scenario);
  for (const textMode of ['html', 'svg']) check(
    `预设形状 ${textMode} 独立进程投影与保存指纹一致`,
    projectedFingerprint[textMode] === savedFingerprint[textMode],
    JSON.stringify({ projected: projectedFingerprint[textMode], saved: savedFingerprint[textMode] }),
  );
  edit.disposeDoc(reopenedDoc);
  edit.disposeDoc(doc);

  const blank = await core.parse(generate.createBlankPptx(), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const generatedDoc = edit.createDoc(blank, { idPrefix: 'preset-shape-generated-' });
  const generatedEditor = new edit.Editor(generatedDoc);
  const slideId = generatedDoc.slideOrder[0];
  generatedEditor.exec({
    type: 'AddShape', slideId, preset: 'roundRect', rect: { x: 90, y: 80, w: 320, h: 180 },
  });
  const generatedId = generatedEditor.selection.ids[0];
  generatedEditor.exec({ type: 'SetAdj', id: generatedId, name: 'adj', value: 37_500 });
  const generatedProjected = generatedEditor.effectiveElement(generatedId).path;
  blank.dispose?.();
  const generated = generate.generateEditDoc(generatedDoc);
  saveArtifact('generated-preset-shape.pptx', generated.bytes);
  const generatedXml = decoder.decode(generated.package.parts['ppt/slides/slide1.xml']);
  const generatedReopened = await core.parse(generated.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const generatedShape = generatedReopened.slides[0].elements
    .find((element) => element.kind === 'shape' && element.name === generatedDoc.elements[generatedId].src.name);
  check('生成保存保留预设调节值并重开为同一路径',
    generatedXml.includes('<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 37500"/></a:avLst></a:prstGeom>')
      && generatedShape?.editInfo?.geom?.preset === 'roundRect'
      && generatedShape.editInfo.geom.adj.adj === 37_500
      && generatedShape.path === generatedProjected);
  generatedReopened.dispose?.();
  edit.disposeDoc(generatedDoc);
}
