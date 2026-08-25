import { diffPackageBytes } from '../diff-package.mjs';
import { unzipSync, zipSync } from 'fflate';
import { isDeepStrictEqual } from 'node:util';

const decoder = new TextDecoder();
const textOf = (shape) => shape.text?.paragraphs
  .flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join('') ?? '';
const appearanceOf = (element) => ({
  path: element?.path, openGeom: element?.openGeom,
  fill: element?.fill, stroke: element?.stroke, effects: element?.effects,
});
const visualTextOf = (element) => JSON.parse(JSON.stringify(
  element?.text, (key, value) => key === 'editInfo' ? undefined : value,
));

/** SetLayout 保存只允许改 slideLayout 关系，投影必须与重开解析严格等价。 */
export async function runChangeLayoutSaveContract({
  core, edit, load, check, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ SetLayout 最小关系写回与连续保存\x1b[0m');
  const input = load('sample-editor-change-layout.pptx');
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'change-layout-save-' });
  const editor = new edit.Editor(doc);
  const slideId = doc.slideOrder[0];
  const sourceLayout = doc.slides[slideId].layoutId;
  const targetLayout = doc.layoutOrder.find((id) => doc.layouts[id].name === '重点内容');
  const slidePart = doc.slides[slideId].origin.part;
  const relsPart = 'ppt/slides/_rels/slide7.xml.rels';
  const sourceSlide = presentation.package.parts[slidePart].slice();

  editor.exec({ type: 'SetLayout', id: slideId, layoutId: targetLayout });
  const saved = await editor.saveDetailed();
  const artifact = saveArtifact('change-layout.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  const relationships = decoder.decode(saved.package.parts[relsPart]);
  check('纯换版式只重写目标页关系 part',
    diff.added.length === 0 && diff.removed.length === 0
      && diff.changed.join(',') === relsPart,
  `changed=${diff.changed}`);
  check('保留原 slideLayout rId 与未知关系，只把目标切到版式 2',
    /Id="rId1"[^>]*Type="[^"]+\/slideLayout"[^>]*Target="\.\.\/slideLayouts\/slideLayout2\.xml"/.test(relationships)
      && relationships.includes('Id="rId99"')
      && relationships.includes('Type="urn:web-ppt:unknown"')
      && relationships.includes('Target="../../customXml/keep.xml"'));
  check('slide XML、备注、媒体、版式、母版和 presentation 全部逐字保留',
    Buffer.from(saved.package.parts[slidePart]).equals(Buffer.from(sourceSlide))
      && [
        'ppt/notesSlides/notesSlide7.xml', 'ppt/media/change-layout.png',
        'ppt/slideLayouts/slideLayout1.xml', 'ppt/slideLayouts/slideLayout2.xml',
        'ppt/slideMasters/slideMaster1.xml', 'ppt/presentation.xml',
      ].every((part) => Buffer.from(saved.package.parts[part])
        .equals(Buffer.from(presentation.package.parts[part]))));

  const reopened = await core.parse(saved.bytes, { edit: true, lazy: false, assets: 'defer' });
  const reopenedTitle = reopened.slides[0].elements.find((element) => element.name === '现有标题');
  const reopenedBody = reopened.slides[0].elements.find((element) => element.name === '现有正文');
  check('保存重开恢复目标版式、继承几何、直设正文、内容、隐藏和备注',
    reopened.slides[0].editInfo.layoutId === targetLayout
      && reopened.slides[0].layoutName === '重点内容'
      && reopenedTitle?.x === 260 && reopenedTitle?.w === 820
      && reopenedBody?.x === 160 && reopenedBody?.w === 900
      && textOf(reopenedTitle) === '现有页面'
      && !reopened.slides[0].elements.some((element) => element.name === '母版标记')
      && reopened.slides[0].hidden === true
      && reopened.slides[0].notes === '换版式必须保留备注');
  const scenario = Object.freeze({
    type: 'changeLayout', file: 'sample-editor-change-layout.pptx', targetLayoutName: '重点内容',
  });
  check('换版式即时投影与保存重开在独立进程两条文本路径等价',
    JSON.stringify(renderFingerprint(scenario.file, 'projected', scenario))
      === JSON.stringify(renderFingerprint(artifact, 'saved', scenario)));
  const identity = await editor.saveDetailed();
  check('换版式连续保存进入包 identity', identity.mode === 'identity'
    && identity.bytes === saved.bytes && identity.package === saved.package);

  editor.undo();
  const restored = await editor.saveDetailed();
  check('首次保存后撤销仍从原关系基线重建来源包',
    doc.slides[slideId].layoutId === sourceLayout
      && diffPackageBytes(input, restored.bytes).equal);
  editor.redo();
  const repeated = await editor.saveDetailed();
  check('重做并再次保存得到相同 OPC 内容',
    doc.slides[slideId].layoutId === targetLayout
      && diffPackageBytes(saved.bytes, repeated.bytes).equal);

  const createdPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const createdDoc = edit.createDoc(createdPresentation, { idPrefix: 'change-layout-created-' });
  const createdEditor = new edit.Editor(createdDoc);
  const createdSource = createdDoc.layoutOrder.find((id) =>
    createdDoc.layouts[id].name === '标题和正文');
  const createdTarget = createdDoc.layoutOrder.find((id) =>
    createdDoc.layouts[id].name === '重点内容');
  const createdResult = createdEditor.exec({
    type: 'AddSlide', layoutId: createdSource, at: { after: createdDoc.slideOrder[0] },
  });
  const createdId = [...createdResult.createdSlides][0];
  const createdCust = Object.values(createdDoc.elements).find((record) =>
    record.parent === createdId && record.meta.ph?.type === 'cust');
  createdEditor.exec({
    type: 'EditText', id: createdCust.id,
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 },
      text: '目标缺失也必须保留',
    }],
  });
  createdEditor.exec({ type: 'SetLayout', id: createdId, layoutId: createdTarget });
  const immediateCreatedTitle = Object.values(createdDoc.elements).find((record) =>
    record.parent === createdId && record.meta.ph?.idx === '1');
  const immediateCreatedNumber = Object.values(createdDoc.elements).find((record) =>
    record.parent === createdId && record.meta.ph?.type === 'sldNum');
  check('会话中新页保存前已采用目标版式继承，而非把来源版式值误作页面直设',
    immediateCreatedTitle
      && createdEditor.effectiveElement(immediateCreatedTitle.id).x === 260
      && createdEditor.effectiveElement(immediateCreatedTitle.id).w === 820
      && immediateCreatedNumber
      && createdEditor.effectiveElement(immediateCreatedNumber.id).x === 1120
      && textOf(createdEditor.effectiveElement(immediateCreatedNumber.id)) === '第 2 页'
      && createdEditor.effectiveElement(immediateCreatedNumber.id)
        .text?.paragraphs[0].runs[0].size === 28
      && createdCust && createdEditor.effectiveElement(createdCust.id).x === 60
      && textOf(createdEditor.effectiveElement(createdCust.id)) === '目标缺失也必须保留');
  const createdPart = createdDoc.slides[createdId].origin.part;
  const createdRelsPart = createdPart.replace(
    /([^/]+)$/,
    '_rels/$1.rels',
  );
  const createdSaved = await createdEditor.saveDetailed();
  const createdRelationships = decoder.decode(createdSaved.package.parts[createdRelsPart]);
  const createdReopened = await core.parse(createdSaved.bytes, {
    edit: true, lazy: false, assets: 'defer',
  });
  const createdSlide = createdReopened.slides[1];
  const createdTitle = createdSlide.elements.find((element) =>
    element.editInfo?.placeholder?.idx === '1');
  const createdNumber = createdSlide.elements.find((element) =>
    element.editInfo?.placeholder?.type === 'sldNum');
  const reopenedCreatedCust = createdSlide.elements.find((element) =>
    element.editInfo?.placeholder?.type === 'cust');
  check('会话中新页换版式以确定 rId 物化目标关系并可重开',
    /Id="rId1"[^>]*Type="[^"]+\/slideLayout"[^>]*Target="\.\.\/slideLayouts\/slideLayout2\.xml"/.test(createdRelationships)
      && createdSlide.editInfo.layoutId === createdTarget
      && createdSlide.layoutName === '重点内容'
      && createdTitle?.x === 260 && createdTitle?.w === 820
      && createdNumber?.x === 1120 && textOf(createdNumber) === '第 2 页'
      && createdNumber?.text?.paragraphs[0].runs.some((run) => run.field === 'slidenum')
      && createdNumber?.text?.paragraphs[0].runs[0].size === 28
      && reopenedCreatedCust?.x === 60
      && textOf(reopenedCreatedCust) === '目标缺失也必须保留');
  createdReopened.dispose?.();
  edit.disposeDoc(createdDoc);

  const textPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const textDoc = edit.createDoc(textPresentation, { idPrefix: 'change-layout-edited-text-' });
  const textEditor = new edit.Editor(textDoc);
  const textSlideId = textDoc.slideOrder[0];
  const editedTitle = Object.values(textDoc.elements).find((record) =>
    record.parent === textSlideId && record.src.name === '现有标题');
  const editedTitleLength = textOf(textEditor.effectiveElement(editedTitle.id)).length;
  textEditor.exec({
    type: 'EditText', id: editedTitle.id,
    ops: [{
      type: 'replace',
      from: { p: 0, r: 0, off: editedTitleLength },
      to: { p: 0, r: 0, off: editedTitleLength }, text: '！',
    }],
  });
  const textTarget = textDoc.layoutOrder.find((id) => textDoc.layouts[id].name === '重点内容');
  textEditor.exec({ type: 'SetLayout', id: textSlideId, layoutId: textTarget });
  const immediateEditedTitle = textEditor.effectiveElement(editedTitle.id);
  const textSaved = await textEditor.saveDetailed();
  const textReopened = await core.parse(textSaved.bytes, { edit: true, lazy: false, assets: 'defer' });
  const reopenedEditedTitle = textReopened.slides[0].elements.find((element) =>
    element.name === '现有标题');
  check('先编辑文字再换版式只保留内容覆盖，未触碰格式立即并在重开后继承目标值',
    textOf(immediateEditedTitle) === '现有页面！'
      && immediateEditedTitle.text?.paragraphs[0].runs[0].size === 48
      && isDeepStrictEqual(visualTextOf(immediateEditedTitle), visualTextOf(reopenedEditedTitle)));
  textReopened.dispose?.();
  edit.disposeDoc(textDoc);

  const shapeFiles = unzipSync(input.slice());
  shapeFiles[slidePart] = new TextEncoder().encode(
    decoder.decode(shapeFiles[slidePart]).replace(
      '<a:masterClrMapping/>',
      '<a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent2" accent2="accent1" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>',
    ),
  );
  const shapeInput = zipSync(shapeFiles, { level: 0 });
  const shapePresentation = await core.parse(shapeInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const shapeDoc = edit.createDoc(shapePresentation, { idPrefix: 'change-layout-created-shape-' });
  const shapeEditor = new edit.Editor(shapeDoc);
  const shapeSlideId = shapeDoc.slideOrder[0];
  shapeEditor.exec({
    type: 'AddShape', slideId: shapeSlideId, preset: 'rect',
    rect: { x: 420, y: 560, w: 180, h: 80 },
  });
  const shapeId = shapeEditor.selection.kind === 'elements' ? shapeEditor.selection.ids[0] : null;
  shapeEditor.exec({
    type: 'EditText', id: shapeId,
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 },
      text: '主题文字',
    }],
  });
  const shapeTarget = shapeDoc.layoutOrder.find((id) => shapeDoc.layouts[id].name === '重点内容');
  shapeEditor.exec({ type: 'SetLayout', id: shapeSlideId, layoutId: shapeTarget });
  const immediateShape = shapeEditor.effectiveElement(shapeId);
  const immediateShapeSlide = shapeEditor.toSlide(shapeSlideId);
  const immediateTargetMarker = immediateShapeSlide.elements.find((element) =>
    element.name === '目标版式角标');
  shapeEditor.undo();
  const restoredShape = shapeEditor.effectiveElement(shapeId);
  shapeEditor.redo();
  const shapeSaved = await shapeEditor.saveDetailed();
  const shapeReopened = await core.parse(shapeSaved.bytes, { edit: true, lazy: false, assets: 'defer' });
  const reopenedShape = shapeReopened.slides[0].elements.find((element) =>
    element.id === shapeDoc.elements[shapeId].meta.origin.spid);
  const reopenedTargetMarker = shapeReopened.slides[0].elements.find((element) =>
    element.name === '目标版式角标');
  check('页面 clrMapOvr 同时作用于目标背景、静态版式节点和新增主题形状',
    immediateShapeSlide.background?.type === 'solid'
      && immediateShapeSlide.background.color === 'rgb(51,102,204)'
      && immediateTargetMarker?.fill?.type === 'solid'
      && immediateTargetMarker.fill.color === 'rgb(0,153,204)'
      && JSON.stringify(immediateShapeSlide.background)
        === JSON.stringify(shapeReopened.slides[0].background)
      && JSON.stringify(immediateTargetMarker?.fill) === JSON.stringify(reopenedTargetMarker?.fill));
  check('切版式前新增且已编辑的主题形状按目标母版重算，并与保存重开一致',
    immediateShape.fill?.type === 'solid'
      && immediateShape.fill.color === 'rgb(51,102,204)'
      && immediateShape.text?.paragraphs[0].runs[0].fonts[0] === 'Target Theme Latin'
      && restoredShape.fill?.type === 'solid'
      && restoredShape.fill.color === 'rgb(166,166,166)'
      && JSON.stringify(immediateShape.fill) === JSON.stringify(reopenedShape?.fill)
      && JSON.stringify(immediateShape.stroke) === JSON.stringify(reopenedShape?.stroke)
      && JSON.stringify(immediateShape.effects) === JSON.stringify(reopenedShape?.effects)
      && isDeepStrictEqual(visualTextOf(immediateShape), visualTextOf(reopenedShape)));
  shapeReopened.dispose?.();
  edit.disposeDoc(shapeDoc);

  const sparseFiles = unzipSync(input.slice());
  sparseFiles[slidePart] = new TextEncoder().encode(
    decoder.decode(sparseFiles[slidePart]).replace(
      /(<p:cNvPr id="809"[\s\S]*?<p:spPr>)[\s\S]*?(<\/p:spPr><p:txBody>)/,
      '$1$2',
    ),
  );
  sparseFiles['ppt/slideLayouts/slideLayout1.xml'] = new TextEncoder().encode(
    decoder.decode(sparseFiles['ppt/slideLayouts/slideLayout1.xml']).replace(
      /(<p:cNvPr id="94"[\s\S]*?)<a:prstGeom prst="rect"><a:avLst\/><\/a:prstGeom><a:noFill\/>/,
      `$1<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="360" h="96"><a:moveTo><a:pt x="0" y="96"/></a:moveTo><a:lnTo><a:pt x="180" y="0"/></a:lnTo><a:lnTo><a:pt x="360" y="96"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom><a:solidFill><a:schemeClr val="accent2"/></a:solidFill>
<a:ln w="19050"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:ln>
<a:effectLst><a:glow rad="28575"><a:schemeClr val="accent2"/></a:glow></a:effectLst>`,
    ),
  );
  const sparseInput = zipSync(sparseFiles, { level: 0 });
  const sparsePresentation = await core.parse(sparseInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const sparseDoc = edit.createDoc(sparsePresentation, { idPrefix: 'change-layout-sparse-' });
  const sparseEditor = new edit.Editor(sparseDoc);
  const sparseSlideId = sparseDoc.slideOrder[0];
  const sparseTarget = sparseDoc.layoutOrder.find((id) => sparseDoc.layouts[id].name === '重点内容');
  const sparseElement = Object.values(sparseDoc.elements).find((record) =>
    record.parent === sparseSlideId && record.src.name === '来源独有内容');
  const sourceSparsePath = sparseEditor.effectiveElement(sparseElement.id).path;
  sparseEditor.exec({ type: 'SetLayout', id: sparseSlideId, layoutId: sparseTarget });
  const immediateSparse = sparseEditor.effectiveElement(sparseElement.id);
  const sparseSaved = await sparseEditor.saveDetailed();
  const sparseReopened = await core.parse(sparseSaved.bytes, { edit: true, lazy: false, assets: 'defer' });
  const reopenedSparse = sparseReopened.slides[0].elements.find((element) =>
    element.name === '来源独有内容');
  check('目标缺失的稀疏旧占位符只物化继承 frame 与完整外观，保存重开严格等价',
    sparseElement && sourceSparsePath === immediateSparse.path
      && sourceSparsePath !== 'M 0 0 H 360 V 96 H 0 Z'
      && immediateSparse.x === 60
      && textOf(immediateSparse) === '找不到目标占位符也不能丢'
      && reopenedSparse?.x === 60 && reopenedSparse.w === 360
      && textOf(reopenedSparse) === '找不到目标占位符也不能丢'
      && isDeepStrictEqual(appearanceOf(immediateSparse), appearanceOf(reopenedSparse))
      && decoder.decode(sparseSaved.package.parts[slidePart]).includes('<a:custGeom')
      && diffPackageBytes(sparseInput, sparseSaved.bytes).changed.sort().join(',')
        === [slidePart, relsPart].sort().join(','));
  sparseReopened.dispose?.();
  edit.disposeDoc(sparseDoc);

  const emptyEffectFiles = unzipSync(sparseInput.slice());
  emptyEffectFiles['ppt/slideLayouts/slideLayout1.xml'] = new TextEncoder().encode(
    decoder.decode(emptyEffectFiles['ppt/slideLayouts/slideLayout1.xml']).replace(
      /<a:effectLst><a:glow[\s\S]*?<\/a:glow><\/a:effectLst>/,
      '<a:effectLst/>',
    ),
  );
  const emptyEffectInput = zipSync(emptyEffectFiles, { level: 0 });
  const emptyEffectPresentation = await core.parse(emptyEffectInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const emptyEffectDoc = edit.createDoc(emptyEffectPresentation, {
    idPrefix: 'change-layout-empty-effect-',
  });
  const emptyEffectEditor = new edit.Editor(emptyEffectDoc);
  const emptyEffectSlideId = emptyEffectDoc.slideOrder[0];
  const emptyEffectTarget = emptyEffectDoc.layoutOrder.find((id) =>
    emptyEffectDoc.layouts[id].name === '重点内容');
  const emptyEffectElement = Object.values(emptyEffectDoc.elements).find((record) =>
    record.parent === emptyEffectSlideId && record.src.name === '来源独有内容');
  emptyEffectEditor.exec({
    type: 'SetLayout', id: emptyEffectSlideId, layoutId: emptyEffectTarget,
  });
  const immediateEmptyEffects = emptyEffectEditor.effectiveElement(emptyEffectElement.id).effects;
  const emptyEffectSaved = await emptyEffectEditor.saveDetailed();
  const emptyEffectReopened = await core.parse(emptyEffectSaved.bytes, {
    edit: true, lazy: false, assets: 'defer',
  });
  const reopenedEmptyEffects = emptyEffectReopened.slides[0].elements.find((element) =>
    element.name === '来源独有内容')?.effects;
  check('目标缺失时显式空效果也物化，保存重开不退化成未定义继承',
    isDeepStrictEqual(immediateEmptyEffects, {})
      && isDeepStrictEqual(reopenedEmptyEffects, {})
      && /<a:effectLst\s*\/>/.test(decoder.decode(emptyEffectSaved.package.parts[slidePart])));
  emptyEffectReopened.dispose?.();
  edit.disposeDoc(emptyEffectDoc);

  const missingFiles = unzipSync(input.slice());
  missingFiles[relsPart] = new TextEncoder().encode(
    decoder.decode(missingFiles[relsPart]).replace(
      /<Relationship\b[^>]*Type="[^"]*\/slideLayout"[^>]*\/>/,
      '',
    ),
  );
  const missingInput = zipSync(missingFiles, { level: 0 });
  const missingPresentation = await core.parse(missingInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const missingDoc = edit.createDoc(missingPresentation, { idPrefix: 'change-layout-missing-rel-' });
  const missingEditor = new edit.Editor(missingDoc);
  const missingSlideId = missingDoc.slideOrder[0];
  const missingTarget = missingDoc.layoutOrder.find((id) =>
    missingDoc.layouts[id].name === '重点内容');
  missingEditor.exec({ type: 'SetLayout', id: missingSlideId, layoutId: missingTarget });
  const missingSaved = await missingEditor.saveDetailed();
  const missingRelationships = decoder.decode(missingSaved.package.parts[relsPart]);
  check('既有页缺少 slideLayout 关系时以最小可用 rId 原子补齐',
    /Id="rId1"[^>]*Type="[^"]+\/slideLayout"[^>]*Target="\.\.\/slideLayouts\/slideLayout2\.xml"/.test(missingRelationships)
      && diffPackageBytes(missingInput, missingSaved.bytes).changed.join(',') === relsPart);
  edit.disposeDoc(missingDoc);

  const strictFiles = unzipSync(input.slice());
  strictFiles[relsPart] = new TextEncoder().encode(
    decoder.decode(strictFiles[relsPart]).replace(
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
      'http://purl.oclc.org/ooxml/officeDocument/relationships/slideLayout',
    ),
  );
  const strictInput = zipSync(strictFiles, { level: 0 });
  const strictPresentation = await core.parse(strictInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const strictDoc = edit.createDoc(strictPresentation, { idPrefix: 'change-layout-strict-' });
  const strictEditor = new edit.Editor(strictDoc);
  const strictSlideId = strictDoc.slideOrder[0];
  const strictTarget = strictDoc.layoutOrder.find((id) =>
    strictDoc.layouts[id].name === '重点内容');
  strictEditor.exec({ type: 'SetLayout', id: strictSlideId, layoutId: strictTarget });
  const strictSaved = await strictEditor.saveDetailed();
  const strictRelationships = decoder.decode(strictSaved.package.parts[relsPart]);
  check('Strict OOXML 复用唯一 slideLayout 关系，不新增 Transitional 关系',
    (strictRelationships.match(/Type="[^"]+\/slideLayout"/g) ?? []).length === 1
      && strictRelationships.includes('Id="rId1"')
      && strictRelationships.includes('http://purl.oclc.org/ooxml/officeDocument/relationships/slideLayout')
      && strictRelationships.includes('Target="../slideLayouts/slideLayout2.xml"')
      && diffPackageBytes(strictInput, strictSaved.bytes).changed.join(',') === relsPart,
  strictRelationships);
  const strictDuplicate = strictEditor.exec({ type: 'DuplicateSlide', id: strictSlideId });
  const strictDuplicateId = [...strictDuplicate.createdSlides][0];
  check('Strict OOXML 页面复制沿用原版式关系身份',
    strictDoc.slides[strictDuplicateId].layoutId === strictTarget
      && strictDoc.slides[strictDuplicateId].creation?.layoutRelationshipId === 'rId1');
  strictEditor.undo();
  edit.disposeDoc(strictDoc);

  reopened.dispose?.();
  edit.disposeDoc(doc);
}
