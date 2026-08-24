import { diffPackageBytes } from '../diff-package.mjs';

const count = (source, needle) => source.split(needle).length - 1;

/** AddSlide 保存只从公开命令、包差异、重开与独立进程渲染取证。 */
export async function runAddSlideSaveContract({
  core, edit, load, check, eq, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ AddSlide OPC 创建、保留型保存与重开\x1b[0m');
  const scenario = Object.freeze({
    type: 'addSlide', file: 'sample-editor-add-slide.pptx',
    titleLayoutName: '标题和正文', blankLayoutName: '空白', text: '浏览器新增页面',
  });
  const input = load(scenario.file);
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'add-slide-save-' });
  const editor = new edit.Editor(doc);
  const firstSlide = doc.slideOrder[0];
  const titleLayout = doc.layoutOrder.find((id) => doc.layouts[id].name === scenario.titleLayoutName);
  const blankLayout = doc.layoutOrder.find((id) => doc.layouts[id].name === scenario.blankLayoutName);
  const titleResult = editor.exec({ type: 'AddSlide', layoutId: titleLayout, at: { after: firstSlide } });
  const titleSlide = [...titleResult.createdSlides][0];
  const title = doc.slides[titleSlide].children.map((id) => doc.elements[id])
    .find((record) => record.meta.ph?.type === 'title');
  editor.exec({
    type: 'EditText', id: title.id,
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 }, text: scenario.text,
    }],
  });
  const blankResult = editor.exec({ type: 'AddSlide', layoutId: blankLayout, at: { after: titleSlide } });
  const blankSlide = [...blankResult.createdSlides][0];
  const saved = await editor.saveDetailed();
  const artifact = saveArtifact('add-slide.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  check('保存只新增两页及其关系，并改写三个全局索引 part',
    diff.added.join(',') === [
      'ppt/slides/_rels/slide8.xml.rels', 'ppt/slides/_rels/slide9.xml.rels',
      'ppt/slides/slide8.xml', 'ppt/slides/slide9.xml',
    ].join(',')
      && diff.removed.length === 0
      && diff.changed.join(',') === [
        '[Content_Types].xml', 'ppt/_rels/presentation.xml.rels', 'ppt/presentation.xml',
      ].join(','));

  const decode = (part) => new TextDecoder().decode(saved.package.parts[part]);
  const presentationXml = decode('ppt/presentation.xml');
  const presentationRels = decode('ppt/_rels/presentation.xml.rels');
  const contentTypes = decode('[Content_Types].xml');
  const slide8 = decode('ppt/slides/slide8.xml');
  const slide8Rels = decode('ppt/slides/_rels/slide8.xml.rels');
  const slide9 = decode('ppt/slides/slide9.xml');
  const slide9Rels = decode('ppt/slides/_rels/slide9.xml.rels');
  check('presentation 页序、section 与尾随未知扩展同时保留',
    presentationXml.indexOf('id="900" r:id="rId40"')
      < presentationXml.indexOf('id="901" r:id="rId78"')
      && presentationXml.indexOf('id="901" r:id="rId78"')
        < presentationXml.indexOf('id="902" r:id="rId79"')
      && /<p14:sldId xmlns:fixture="urn:web-ppt:add-slide" fixture:id="999" id="900"\/><p14:sldId id="901"\/><p14:sldId id="902"\/>/.test(presentationXml)
      && presentationXml.includes('<fixture:sldId id="KEEP-SECTION"/>')
      && presentationXml.includes('value="presentation-tail"'));
  check('presentation 关系与 Content Types 追加唯一引用且未知内容原位保留',
    presentationRels.includes('Id="rId78"') && presentationRels.includes('Target="slides/slide8.xml"')
      && presentationRels.includes('Id="rId79"') && presentationRels.includes('Target="slides/slide9.xml"')
      && presentationRels.includes('Id="rId77" Type="urn:web-ppt:unknown"')
      && count(contentTypes, 'PartName="/ppt/slides/slide8.xml"') === 1
      && count(contentTypes, 'PartName="/ppt/slides/slide9.xml"') === 1
      && contentTypes.includes('PartName="/customXml/keep.xml"'));
  check('新 slide 与 rels 使用合法骨架、所选版式和空提示文字',
    slide8.includes('<p:sld') && slide8.includes('<p:spTree>')
      && count(slide8, '<p:ph ') === 4 && slide8.includes(scenario.text)
      && slide8.includes('type="slidenum"') && slide8.includes('<a:t>2</a:t>')
      && slide8.includes('fixture:type="KEEP-TYPE"')
      && slide8.includes('<fixture:t>KEEP-FIELD</fixture:t>')
      && !slide8.includes('单击此处')
      && slide8Rels.includes('Target="../slideLayouts/slideLayout1.xml"')
      && count(slide9, '<p:ph ') === 0
      && slide9Rels.includes('Target="../slideLayouts/slideLayout2.xml"'));

  const reopened = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedDoc = edit.createDoc(reopened, { idPrefix: 'add-slide-reopened-' });
  const reopenedEditor = new edit.Editor(reopenedDoc);
  check('保存重开得到三页、真实版式、占位符几何与输入文字',
    reopened.slides.length === 3
      && reopened.slides[1].layoutName === scenario.titleLayoutName
      && reopened.slides[2].layoutName === scenario.blankLayoutName
      && reopened.slides[1].elements.some((element) => element.kind === 'shape'
        && element.editInfo?.placeholder?.type === 'title'
        && element.x === 80 && element.y === 80 && element.w === 1120 && element.h === 100
        && element.text?.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text === scenario.text)))
      && reopened.slides[1].elements.some((element) => element.kind === 'shape'
        && element.editInfo?.placeholder?.type === 'sldNum'
        && element.text?.paragraphs.some((paragraph) =>
          paragraph.runs.map((run) => run.text).join('') === '第 2 页'
            && paragraph.runs.some((run) => run.field === 'slidenum' && run.text === '2')))
      && reopenedEditor.toSlide(reopenedDoc.slideOrder[0]).elements.some((element) =>
        element.name === '现有页下一页链接' && element.link === 'slide:2')
      && reopenedEditor.toSlide(reopenedDoc.slideOrder[0]).elements.some((element) =>
        element.name === '现有页自身链接' && element.link === 'slide:1')
      && reopenedEditor.toSlide(reopenedDoc.slideOrder[1]).elements.some((element) =>
        element.name === '版式下一页链接' && element.link === 'slide:3')
      && reopened.slides[2].elements.some((element) => element.name === '空白版式角标'));

  for (const resultSlideIndex of [0, 1, 2]) {
    const fingerprintScenario = { ...scenario, resultSlideIndex };
    const projected = renderFingerprint(scenario.file, 'projected', fingerprintScenario);
    const materialized = renderFingerprint(artifact, 'saved', fingerprintScenario);
    for (const mode of ['html', 'svg']) {
      eq(`新增第 ${resultSlideIndex + 1} 页 ${mode} 保存指纹等于独立进程投影`,
        materialized[mode], projected[mode]);
    }
  }

  const savedAgain = await editor.saveDetailed();
  const secondPresentation = new TextDecoder().decode(savedAgain.package.parts['ppt/presentation.xml']);
  check('连续保存不重复 page、relationship、Override 或 section 引用',
    count(secondPresentation, 'id="901" r:id="rId78"') === 1
      && count(secondPresentation, '<p14:sldId id="901"/>') === 1
      && count(new TextDecoder().decode(savedAgain.package.parts['ppt/_rels/presentation.xml.rels']), 'Id="rId78"') === 1
      && count(new TextDecoder().decode(savedAgain.package.parts['[Content_Types].xml']), '/ppt/slides/slide8.xml') === 1);

  editor.undo();
  editor.undo();
  editor.undo();
  const restored = await editor.saveDetailed();
  const restoredDiff = diffPackageBytes(input, restored.bytes);
  check('保存后撤销两页与文字会删除生成 part 并恢复原包内容', restoredDiff.equal);
  editor.redo();
  editor.redo();
  editor.redo();
  const redone = await editor.saveDetailed();
  check('重做恢复相同四个生成 part 和三页顺序',
    diffPackageBytes(saved.bytes, redone.bytes).equal);

  const oraclePresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const oracleDoc = edit.createDoc(oraclePresentation, { idPrefix: 'add-slide-lo-' });
  const oracleEditor = new edit.Editor(oracleDoc);
  const oracleLayout = oracleDoc.layoutOrder.find((id) => oracleDoc.layouts[id].name === scenario.titleLayoutName);
  const oracleResult = oracleEditor.exec({ type: 'AddSlide', layoutId: oracleLayout, at: { after: null } });
  const oracleSlide = [...oracleResult.createdSlides][0];
  const oracleTitle = oracleDoc.slides[oracleSlide].children.map((id) => oracleDoc.elements[id])
    .find((record) => record.meta.ph?.type === 'title');
  oracleEditor.exec({
    type: 'EditText', id: oracleTitle.id,
    ops: [{
      type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 }, text: 'LibreOffice新增页',
    }],
  });
  const oracleSaved = await oracleEditor.saveDetailed();
  saveArtifact('add-slide-first.pptx', oracleSaved.bytes);
  const oracleReopened = await core.parse(oracleSaved.bytes, { lazy: false, assets: 'defer' });
  check('新增页置首的模型顺序会精确写入 presentation.xml 并供 LibreOffice 几何取证',
    oracleEditor.doc.slideOrder[0] === oracleSlide && oracleSaved.bytes.length > 0
      && oracleReopened.slides[0].elements.some((element) => element.kind === 'shape'
        && element.text?.paragraphs.some((paragraph) => paragraph.runs
          .some((run) => run.text.includes('LibreOffice')))));

  const sequencePresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const sequenceDoc = edit.createDoc(sequencePresentation, { idPrefix: 'add-slide-sequence-' });
  const sequenceEditor = new edit.Editor(sequenceDoc);
  const sequenceLayout = sequenceDoc.layoutOrder.find((id) =>
    sequenceDoc.layouts[id].name === scenario.titleLayoutName);
  const sequenceAnchor = sequenceDoc.slideOrder[0];
  const older = [...sequenceEditor.exec({
    type: 'AddSlide', layoutId: sequenceLayout, at: { after: sequenceAnchor },
  }).createdSlides][0];
  const newer = [...sequenceEditor.exec({
    type: 'AddSlide', layoutId: sequenceLayout, at: { after: sequenceAnchor },
  }).createdSlides][0];
  const sequenceSaved = await sequenceEditor.saveDetailed();
  const sequenceXml = new TextDecoder().decode(
    sequenceSaved.package.parts['ppt/presentation.xml'],
  );
  const olderXml = new TextDecoder().decode(sequenceSaved.package.parts[sequenceDoc.slides[older].origin.part]);
  const newerXml = new TextDecoder().decode(sequenceSaved.package.parts[sequenceDoc.slides[newer].origin.part]);
  check('同锚点连续新增的 presentation、section 与页码字段缓存遵循同一最终页序',
    sequenceDoc.slideOrder.join(',') === `${sequenceAnchor},${newer},${older}`
      && sequenceXml.indexOf('id="902" r:id="rId79"') < sequenceXml.indexOf('id="901" r:id="rId78"')
      && /<p14:sldId xmlns:fixture="urn:web-ppt:add-slide" fixture:id="999" id="900"\/><p14:sldId id="902"\/><p14:sldId id="901"\/>/.test(sequenceXml)
      && newerXml.includes('type="slidenum"') && newerXml.includes('<a:t>2</a:t>')
      && olderXml.includes('type="slidenum"') && olderXml.includes('<a:t>3</a:t>'));

  const relationPresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const relationDoc = edit.createDoc(relationPresentation, { idPrefix: 'add-slide-rel-' });
  const relationEditor = new edit.Editor(relationDoc);
  const relationLayout = relationDoc.layoutOrder.find((id) =>
    relationDoc.layouts[id].name === scenario.titleLayoutName);
  const relationResult = relationEditor.exec({
    type: 'AddSlide', layoutId: relationLayout, at: { after: relationDoc.slideOrder[0] },
  });
  const relationSlide = [...relationResult.createdSlides][0];
  const mediaPresentation = await core.parse(load('sample-media.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const mediaDoc = edit.createDoc(mediaPresentation, { idPrefix: 'add-slide-media-' });
  const image = Object.values(mediaDoc.elements).find((record) =>
    record.src.kind === 'image' && record.meta.editable === 'full');
  relationEditor.exec({
    type: 'PasteElements', payload: edit.copyElements(mediaDoc, [image.id]),
    at: { parentId: relationSlide, x: 540, y: 320 },
  });
  const pasted = relationEditor.selection.kind === 'elements'
    ? relationDoc.elements[relationEditor.selection.ids[0]] : undefined;
  check('新页预留 rId1 给版式，既有关系型编辑从 rId2 分配',
    pasted?.meta.insertion?.relationships?.[0]?.targetId === 'rId2');
  const relationSaved = await relationEditor.saveDetailed();
  const relationRels = new TextDecoder().decode(
    relationSaved.package.parts['ppt/slides/_rels/slide8.xml.rels'],
  );
  check('新页保存会合并版式与后续元素关系，不让其中一方覆盖另一方',
    relationRels.includes('Id="rId1"') && relationRels.includes('/slideLayout')
      && relationRels.includes('Id="rId2"') && relationRels.includes('/image'));

  edit.disposeDoc(reopenedDoc);
  oracleReopened.dispose?.();
  edit.disposeDoc(sequenceDoc);
  edit.disposeDoc(mediaDoc);
  edit.disposeDoc(relationDoc);
  edit.disposeDoc(oracleDoc);
  edit.disposeDoc(doc);
  return { artifact, titleSlide, blankSlide };
}
