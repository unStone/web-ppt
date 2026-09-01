import { diffPackageBytes } from '../diff-package.mjs';

const decoder = new TextDecoder();
const range = (p) => ({ from: { p, r: 0, off: 0 }, to: { p, r: 0, off: 0 } });
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

/** 从公开保存入口与重开投影验证 DrawingML 项目符号写回。 */
export async function runBulletFormatSaveContract({
  core, edit, load, check, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ 项目符号与自动编号保存重开\x1b[0m');
  const scenario = {
    type: 'text', file: 'sample-editor-list-level.pptx', targetName: '多级列表', edits: [],
    paragraphFormats: [
      { targetName: '多级列表', range: range(0),
        props: { bullet: { kind: 'char', char: '→', font: 'Arial' } } },
      { targetName: '多级列表', range: range(1), props: { bullet: { kind: 'none' } } },
      { targetName: '多级列表', range: range(2),
        props: { bullet: { kind: 'autoNum', type: 'romanLcPeriod', startAt: 5 } } },
    ],
  };
  const input = load(scenario.file);
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'bullet-format-save-' });
  const editor = new edit.Editor(doc);
  const record = Object.values(doc.elements)
    .find((candidate) => candidate.src.name === '多级列表');
  editor.exec({
    type: 'SetParaProps', id: record.id, range: range(0),
    props: { bullet: { kind: 'char', char: '→', font: 'Arial' } },
  });
  editor.exec({
    type: 'SetParaProps', id: record.id, range: range(1), props: { bullet: { kind: 'none' } },
  });
  editor.exec({
    type: 'SetParaProps', id: record.id, range: range(2),
    props: { bullet: { kind: 'autoNum', type: 'romanLcPeriod', startAt: 5 } },
  });
  const expected = editor.effectiveElement(record.id).text.paragraphs
    .map((paragraph) => paragraph.bullet);
  check('修改前序列表后会即时重算未直接编辑的后续自动编号',
    expected[3] === '1.', JSON.stringify(expected));

  const saved = await editor.saveDetailed();
  const artifact = saveArtifact('bullet-format-editing.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  const xml = decoder.decode(saved.package.parts['ppt/slides/slide1.xml']);
  check('项目符号保存只重写目标 slide part',
    saved.mode === 'passthrough' && saved.rewrittenEntries === 1
      && diff.added.length === 0 && diff.removed.length === 0
      && diff.changed.join(',') === 'ppt/slides/slide1.xml');
  check('字符、无符号与自动编号按 DrawingML 顺序互斥写回',
    xml.includes('<a:buFont typeface="Arial"/><a:buChar char="→"/>')
      && xml.includes('<a:pPr><a:buNone/></a:pPr><a:r><a:t>一级二</a:t>')
      && xml.includes('<a:pPr lvl="1"><a:buAutoNum type="romanLcPeriod" startAt="5"/></a:pPr>')
      && !xml.includes('<a:buNone/><a:buChar') && !xml.includes('<a:buChar char="→"/><a:buAutoNum'));

  const reopened = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedElement = reopened.slides[0].elements
    .find((element) => element.name === '多级列表');
  check('项目符号保存重开投影与即时预览一致',
    JSON.stringify(reopenedElement.text.paragraphs
      .map((paragraph) => paragraph.bullet)) === JSON.stringify(expected),
    JSON.stringify({ expected, actual: reopenedElement.text.paragraphs
      .map((paragraph) => paragraph.bullet) }));
  const projectedFingerprint = renderFingerprint(scenario.file, 'projected', scenario);
  const savedFingerprint = renderFingerprint(artifact, 'saved', scenario);
  for (const textMode of ['html', 'svg']) check(
    `项目符号保存产物 ${textMode} 指纹等于独立进程中的有效投影`,
    savedFingerprint[textMode] === projectedFingerprint[textMode],
    JSON.stringify({ projected: projectedFingerprint[textMode], saved: savedFingerprint[textMode] }),
  );

  reopened.dispose?.();
  edit.disposeDoc(doc);
  presentation.dispose?.();

  const clearPresentation = await core.parse(load('sample-editor-bullets.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const clearDoc = edit.createDoc(clearPresentation, { idPrefix: 'bullet-clear-save-' });
  const clearEditor = new edit.Editor(clearDoc);
  const clearRecord = Object.values(clearDoc.elements)
    .find((candidate) => candidate.src.name === '项目符号编辑');
  clearEditor.exec({
    type: 'SetParaProps', id: clearRecord.id, range: range(2), props: { bullet: null },
  });
  const cleared = await clearEditor.saveDetailed();
  saveArtifact('bullet-clear-direct.pptx', cleared.bytes);
  const clearedXml = decoder.decode(cleared.package.parts['ppt/slides/slide1.xml']);
  const clearReopened = await core.parse(cleared.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const clearedParagraph = clearReopened.slides[0].elements
    .find((element) => element.name === '项目符号编辑').text.paragraphs[2];
  check('bullet:null 写回删除整组直设并让重开恢复纯继承样式',
    !clearedXml.includes('val="C00000"') && !clearedXml.includes('val="125000"')
      && !clearedXml.includes('typeface="Wingdings"') && !clearedXml.includes('char=""')
      && clearedParagraph.bullet === '1.' && clearedParagraph.bulletColor === null
      && clearedParagraph.bulletFont === null && clearedParagraph.bulletSize === null,
    JSON.stringify({ bullet: clearedParagraph.bullet, color: clearedParagraph.bulletColor,
      font: clearedParagraph.bulletFont, size: clearedParagraph.bulletSize }));
  clearReopened.dispose?.();
  edit.disposeDoc(clearDoc);
  clearPresentation.dispose?.();

  const imageInput = load('sample-editor-bullets.pptx');
  const imagePresentation = await core.parse(imageInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const imageDoc = edit.createDoc(imagePresentation, { idPrefix: 'bullet-image-save-' });
  const imageEditor = new edit.Editor(imageDoc);
  const imageRecord = Object.values(imageDoc.elements)
    .find((candidate) => candidate.src.name === '项目符号编辑');
  const imageText = imageEditor.effectiveElement(imageRecord.id).text;
  const unstyledSource = imageText.paragraphs[0];
  const unstyledFragment = edit.textFragmentFromRange(
    { ...imageText, paragraphs: [unstyledSource] },
    { from: { p: 0, r: 0, off: 0 }, to: {
      p: 0, r: unstyledSource.runs.length - 1,
      off: unstyledSource.runs.at(-1).text.length,
    } },
  );
  const styledTarget = imageText.paragraphs[2];
  imageEditor.exec({
    type: 'EditText', id: imageRecord.id, ops: [{
      type: 'replaceFragment', from: { p: 2, r: 0, off: 0 },
      to: { p: 2, r: styledTarget.runs.length - 1, off: styledTarget.runs.at(-1).text.length },
      fragment: unstyledFragment,
    }],
  });
  const unstyledProjected = imageEditor.effectiveElement(imageRecord.id).text.paragraphs[2];
  const importedImage = edit.queryParaProps(imageDoc, imageRecord.id, range(4)).bullet.value;
  imageEditor.exec({
    type: 'SetParaProps', id: imageRecord.id, range: range(4), props: { bullet: {
      ...importedImage, font: 'Arial', color: '#C00000',
      size: { kind: 'points', value: 24 },
    } },
  });
  imageEditor.exec({
    type: 'SetParaProps', id: imageRecord.id, range: range(0), props: { bullet: {
      kind: 'blip', image: {
        bytes: Uint8Array.from(Buffer.from(PNG_1PX, 'base64')), mime: 'image/png',
      }, font: 'Wingdings', color: '#336699', size: { kind: 'percent', value: 1.35 },
    } },
  });
  const imageSaved = await imageEditor.saveDetailed();
  saveArtifact('bullet-image-editing.pptx', imageSaved.bytes);
  const imageDiff = diffPackageBytes(imageInput, imageSaved.bytes);
  const imageXml = decoder.decode(imageSaved.package.parts['ppt/slides/slide1.xml']);
  const relXml = decoder.decode(imageSaved.package.parts['ppt/slides/_rels/slide1.xml.rels']);
  const mediaParts = Object.keys(imageSaved.package.parts)
    .filter((part) => part.startsWith('ppt/media/web-ppt-'));
  check('图片项目符号保存原子补齐 slide、关系、媒体与 Content Types',
    imageSaved.mode === 'passthrough' && imageSaved.rewrittenEntries === 4
      && mediaParts.length === 1 && imageDiff.added.length === 1
      && imageDiff.added[0] === mediaParts[0]
      && imageDiff.changed.sort().join(',') === [
        '[Content_Types].xml', 'ppt/slides/_rels/slide1.xml.rels', 'ppt/slides/slide1.xml',
      ].sort().join(',')
      && /<a:buClr><a:srgbClr\b[^>]*\bval="336699"\/><\/a:buClr>/.test(imageXml)
      && imageXml.includes('<a:buSzPct val="135000"/>')
      && imageXml.includes('<a:buFont typeface="Wingdings"/>')
      && /<a:buBlip><a:blip r:embed="rId\d+"\/><\/a:buBlip>/.test(imageXml)
      && /Type="[^"]+\/image" Target="\.\.\/media\/web-ppt-[^"]+\.png"/.test(relXml),
    JSON.stringify({ rewritten: imageSaved.rewrittenEntries, diff: imageDiff, mediaParts }));
  const imageReopened = await core.parse(imageSaved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedImageParagraph = imageReopened.slides[0].elements
    .find((element) => element.name === '项目符号编辑').text.paragraphs[0];
  const reopenedImportedImageParagraph = imageReopened.slides[0].elements
    .find((element) => element.name === '项目符号编辑').text.paragraphs[4];
  const reopenedUnstyledParagraph = imageReopened.slides[0].elements
    .find((element) => element.name === '项目符号编辑').text.paragraphs[2];
  check('无样式项目符号粘到带直设样式段落后即时投影与保存重开一致',
    unstyledFragment.paragraphs[0].bullet?.kind === 'autoNum'
      && !Object.prototype.hasOwnProperty.call(unstyledFragment.paragraphs[0].bullet, 'font')
      && unstyledProjected.bulletFont === null && unstyledProjected.bulletColor === null
      && unstyledProjected.bulletSize === null
      && reopenedUnstyledParagraph.bulletFont === null
      && reopenedUnstyledParagraph.bulletColor === null
      && reopenedUnstyledParagraph.bulletSize === null,
    JSON.stringify({ fragment: unstyledFragment.paragraphs[0].bullet,
      projected: { font: unstyledProjected.bulletFont, color: unstyledProjected.bulletColor,
        size: unstyledProjected.bulletSize },
      reopened: { font: reopenedUnstyledParagraph.bulletFont,
        color: reopenedUnstyledParagraph.bulletColor, size: reopenedUnstyledParagraph.bulletSize } }));
  check('图片项目符号保存重开保持可渲染图片与结构语义',
    reopenedImageParagraph.bullet === null
      && reopenedImageParagraph.bulletImage?.startsWith('asset:')
      && reopenedImageParagraph.editInfo?.bullet.kind === 'image'
      && reopenedImageParagraph.editInfo.bullet.font === 'Wingdings'
      && reopenedImageParagraph.editInfo.bullet.color === 'rgb(51,102,153)'
      && reopenedImageParagraph.editInfo.bullet.size?.value === 1.35
      && importedImage?.kind === 'blip'
      && reopenedImportedImageParagraph.editInfo?.bullet.kind === 'image'
      && reopenedImportedImageParagraph.editInfo.bullet.font === 'Arial'
      && reopenedImportedImageParagraph.editInfo.bullet.color === 'rgb(192,0,0)'
      && reopenedImportedImageParagraph.editInfo.bullet.size?.kind === 'points'
      && reopenedImportedImageParagraph.editInfo.bullet.size.value === 24,
    JSON.stringify({ bullet: reopenedImageParagraph.bullet,
      bulletImage: reopenedImageParagraph.bulletImage,
      semantic: reopenedImageParagraph.editInfo?.bullet,
      importedSemantic: reopenedImportedImageParagraph.editInfo?.bullet }));
  imageReopened.dispose?.();
  edit.disposeDoc(imageDoc);
  imagePresentation.dispose?.();
}
