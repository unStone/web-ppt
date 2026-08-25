import { diffPackageBytes } from '../diff-package.mjs';
import { makePng } from './ooxml.mjs';

const decoder = new TextDecoder();

/** 页面图片背景只从公开保存、包差异、关系 XML 与 core 重开取证。 */
export async function runSlideImageBackgroundSaveContract({
  core, edit, load, check, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ 页面图片背景媒体闭包保存\x1b[0m');
  const input = load('sample-editor-slide-image-background.pptx');
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'slide-image-background-save-' });
  const editor = new edit.Editor(doc);
  const [stretchId, tileId, inheritedId] = doc.slideOrder;
  const replacement = makePng(11, 7,
    (x, y) => [240 - x * 17, 25 + y * 27, (x * 23 + y * 41) % 256], 120);
  const replacementMetadata = core.readImageMetadata(replacement);
  const scenario = Object.freeze({
    type: 'slideImageBackground', file: 'sample-editor-slide-image-background.pptx',
    base64: Buffer.from(replacement).toString('base64'), mime: 'image/png', alpha: 0.65,
    tile: { sx: 0.5, sy: 0.75, flip: 'x', tx: 3, ty: -2, algn: 'br' },
    crops: [
      { l: 0.2, t: 0.1, r: 0.15, b: 0.05 },
      { l: 0.05, t: 0.1, r: 0.2, b: 0.15 },
      { l: 0.1, t: 0.15, r: 0.2, b: 0.25 },
    ],
    addedCrop: { l: 0.08, t: 0.12, r: 0.18, b: 0.22 },
  });
  editor.exec({
    type: 'SetBackgroundCrop', id: stretchId,
    crop: scenario.crops[0],
  });
  editor.exec({
    type: 'SetBackgroundImage', id: tileId, bytes: replacement, mime: 'image/png',
    crop: scenario.crops[1], alpha: scenario.alpha, tile: scenario.tile,
  });
  editor.exec({
    type: 'SetBackgroundCrop', id: inheritedId,
    crop: scenario.crops[2],
  });
  const sourceHash = doc.slides[stretchId].backgroundImage.resourceHash;
  const inheritedHash = doc.slides[inheritedId].backgroundImage.resourceHash;
  const replacementHash = doc.slides[tileId].backgroundImage.resourceHash;
  const sourcePart = doc.imageResources[sourceHash].targetPart;
  const inheritedPart = doc.imageResources[inheritedHash].targetPart;
  const replacementPart = doc.imageResources[replacementHash].targetPart;
  const saved = await editor.saveDetailed();
  const diff = diffPackageBytes(input, saved.bytes);
  check('三页背景只修改各自 slide/关系并增加一个去重媒体',
    sourcePart === 'ppt/media/slide-background.png'
      && inheritedPart === 'ppt/media/inherited-background.bmp'
      && diff.added.join(',') === replacementPart && diff.removed.length === 0
      && diff.changed.join(',') === [
        'ppt/slides/_rels/slide2.xml.rels', 'ppt/slides/_rels/slide3.xml.rels', 'ppt/slides/slide1.xml',
        'ppt/slides/slide2.xml', 'ppt/slides/slide3.xml',
      ].join(','),
  `added=${diff.added} changed=${diff.changed}`);

  const slide1 = decoder.decode(saved.package.parts['ppt/slides/slide1.xml']);
  const slide2 = decoder.decode(saved.package.parts['ppt/slides/slide2.xml']);
  const slide3 = decoder.decode(saved.package.parts['ppt/slides/slide3.xml']);
  const slide3Rels = decoder.decode(saved.package.parts['ppt/slides/_rels/slide3.xml.rels']);
  check('来源图片背景原位修改已知语义并保留未知宿主、blip 与裁剪扩展',
    slide1.includes('fixture:slot="stretch"') && slide1.includes('fixture:keep="stretch"')
      && slide1.includes('<fixture:keep value="blip-extension"/>')
      && slide1.includes('<fixture:keep value="crop-extension"/>')
      && slide1.includes('<fixture:keep value="host-extension"/>')
      && slide1.includes('<a:blipFill dpi="96"')
      && doc.slides[stretchId].backgroundImage.sourcePart === 'ppt/slides/slide1.xml'
      && Buffer.from(saved.package.parts['ppt/slides/_rels/slide1.xml.rels'])
        .equals(Buffer.from(presentation.package.parts['ppt/slides/_rels/slide1.xml.rels']))
      && /<a:srcRect\b[^>]*\bl="20000"[^>]*\bt="10000"[^>]*\br="15000"[^>]*\bb="5000"/.test(slide1));
  check('上传平铺背景写回 blip、透明度、裁剪和平铺参数',
    /<a:blip\b[^>]*\br:embed="rId\d+"/.test(slide2)
      && slide2.includes('<a:alphaModFix amt="65000"/>')
      && /<a:srcRect\b[^>]*\bl="5000"[^>]*\bt="10000"[^>]*\br="20000"[^>]*\bb="15000"/.test(slide2)
      && /<a:tile\b[^>]*\bsx="50000"[^>]*\bsy="75000"[^>]*\bflip="x"[^>]*\btx="28575"[^>]*\bty="-19050"[^>]*\balgn="br"/.test(slide2)
      && !/<a:blipFill\b[^>]*\bdpi=/.test(slide2)
      && !slide2.includes('<a:stretch>'));
  check('版式继承图片裁剪克隆来源 blipFill 未知语义且不修改共享版式',
    slide3.includes('fixture:slot="inherited"')
      && slide3.includes('xmlns:fixture="urn:web-ppt:slide-image-background"')
      && slide3.includes('fixture:keep="inherited"')
      && slide3.includes('dpi="120"')
      && slide3.includes('<fixture:keep value="inherited-blip-extension"/>')
      && slide3.includes('<fixture:keep value="inherited-crop-extension"/>')
      && slide3.includes('<fixture:keep value="inherited-host-extension"/>')
      && /<fixture:linked\b[^>]*\br:id="(rId\d+)"/.test(slide3)
      && /<fixture:media\b[^>]*\br:id="(rId\d+)"/.test(slide3)
      && slide3Rels.includes('Target="https://example.com/background-extension" TargetMode="External"')
      && slide3Rels.includes(`Id="${slide3.match(/<fixture:linked\b[^>]*\br:id="(rId\d+)"/)?.[1]}"`)
      && slide3Rels.includes(`Id="${slide3.match(/<fixture:media\b[^>]*\br:id="(rId\d+)"/)?.[1]}"`)
      && slide3Rels.includes('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio"')
      && slide3Rels.includes('Target="../media/inherited-background.wav"')
      && /<a:srcRect\b[^>]*\bl="10000"[^>]*\bt="15000"[^>]*\br="20000"[^>]*\bb="25000"/.test(slide3)
      && Buffer.from(saved.package.parts['ppt/slideLayouts/slideLayout1.xml'])
        .equals(Buffer.from(presentation.package.parts['ppt/slideLayouts/slideLayout1.xml'])));

  const duplicated = [...editor.exec({ type: 'DuplicateSlide', id: inheritedId }).createdSlides][0];
  const added = [...editor.exec({
    type: 'AddSlide', layoutId: doc.layoutOrder[0], at: { after: doc.slideOrder.at(-1) },
  }).createdSlides][0];
  editor.exec({
    type: 'SetBackgroundImage', id: added, bytes: replacement, mime: scenario.mime,
    crop: scenario.addedCrop,
  });
  check('复制图片背景与新增页复用媒体但保持页面关系独立',
    doc.slides[duplicated].backgroundImage.resourceHash === inheritedHash
      && doc.slides[added].backgroundImage.resourceHash === replacementHash
      && doc.slides[duplicated].backgroundImage.relationships[0].targetId
        === doc.slides[inheritedId].backgroundImage.relationships[0].targetId
      && Object.keys(doc.imageResources).length === 4);
  const expanded = await editor.saveDetailed();
  const artifact = saveArtifact('slide-image-background.pptx', expanded.bytes);
  const expandedDiff = diffPackageBytes(saved.bytes, expanded.bytes);
  check('复制与新增页只物化新页面闭包并复用已有媒体',
    expandedDiff.added.filter((part) => part.startsWith('ppt/media/')).length === 0
      && ['ppt/slides/slide4.xml', 'ppt/slides/_rels/slide4.xml.rels',
        'ppt/slides/slide5.xml', 'ppt/slides/_rels/slide5.xml.rels']
        .every((part) => expandedDiff.added.includes(part)));

  const reopened = await core.parse(expanded.bytes, { edit: true, lazy: false, assets: 'defer' });
  check('保存重开恢复五页图片、裁剪、透明度与平铺语义',
    reopened.slides.length === 5
      && reopened.slides.every((slide) => slide.background?.type === 'image')
      && JSON.stringify(reopened.slides[0].background.crop)
        === JSON.stringify({ l: 0.2, t: 0.1, r: 0.15, b: 0.05 })
      && reopened.slides[1].background.alpha === 0.65
      && JSON.stringify(reopened.slides[1].background.tile)
        === JSON.stringify({
          sx: 0.5, sy: 0.75, flip: 'x', tx: 3, ty: -2, algn: 'br',
          sourceWidth: 11 * 96 / replacementMetadata.dpiX,
          sourceHeight: 7 * 96 / replacementMetadata.dpiY,
        })
      && JSON.stringify(reopened.slides[2].background.crop)
        === JSON.stringify({ l: 0.1, t: 0.15, r: 0.2, b: 0.25 })
      && JSON.stringify(reopened.slides[3].background.crop)
        === JSON.stringify({ l: 0.1, t: 0.15, r: 0.2, b: 0.25 })
      && JSON.stringify(reopened.slides[4].background.crop) === JSON.stringify(scenario.addedCrop));
  let fingerprintsEqual = true;
  for (let resultSlideIndex = 0; resultSlideIndex < 5; resultSlideIndex++) {
    const proof = { ...scenario, resultSlideIndex };
    fingerprintsEqual = fingerprintsEqual
      && JSON.stringify(renderFingerprint(scenario.file, 'projected', proof))
        === JSON.stringify(renderFingerprint(artifact, 'saved', proof));
  }
  check('五页图片背景编辑投影与保存重开在独立进程两条文本路径等价', fingerprintsEqual);
  const identity = await editor.saveDetailed();
  check('页面图片背景连续保存进入包 identity', identity.mode === 'identity'
    && identity.bytes === expanded.bytes && identity.package === expanded.package);

  const oraclePresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const oracleDoc = edit.createDoc(oraclePresentation, { idPrefix: 'slide-image-tile-oracle-' });
  const oracleEditor = new edit.Editor(oracleDoc);
  const [oracleStretch, oracleTile, oracleInherited] = oracleDoc.slideOrder;
  oracleEditor.exec({ type: 'RemoveSlide', id: oracleInherited });
  oracleEditor.exec({ type: 'RemoveSlide', id: oracleStretch });
  const oracleSaved = await oracleEditor.saveDetailed();
  saveArtifact('slide-image-background-tile-oracle.pptx', oracleSaved.bytes);
  const oracleReopened = await core.parse(oracleSaved.bytes, { lazy: false, assets: 'defer' });
  check('LibreOffice 像素真值固化为只含来源平铺页的独立 Office 产物',
    oracleDoc.slideOrder[0] === oracleTile && oracleReopened.slides.length === 1
      && JSON.stringify(oracleReopened.slides[0].background?.tile) === JSON.stringify({
        sx: 0.65, sy: 0.8, flip: 'xy', tx: 10, ty: -2, algn: 'ctr',
        sourceWidth: 96, sourceHeight: 54,
      }));
  oracleReopened.dispose?.();
  edit.disposeDoc(oracleDoc);
  editor.exec({ type: 'RemoveSlide', id: duplicated });
  editor.exec({ type: 'RemoveSlide', id: added });
  editor.exec({ type: 'SetBackground', id: stretchId, fill: null });
  editor.exec({ type: 'SetBackground', id: tileId, fill: null });
  editor.exec({ type: 'SetBackground', id: inheritedId, fill: null });
  editor.exec({
    type: 'SetBackgroundCrop', id: inheritedId,
    crop: { l: 0.02, t: 0.03, r: 0.04, b: 0.05 },
  });
  check('保存后恢复来源再裁剪仍从初始 BMP 与版式关系基线建闭包',
    doc.slides[inheritedId].backgroundImage.resourceHash === inheritedHash
      && doc.slides[inheritedId].backgroundImage.relationships.length === 3
      && doc.slides[inheritedId].backgroundImage.resourceHashes.length === 2);
  editor.undo();
  const reset = await editor.saveDetailed();
  check('全部恢复来源后逐字节回到原包并回收会话媒体', diffPackageBytes(input, reset.bytes).equal);
  reopened.dispose?.();
  edit.disposeDoc(doc);

  const duplicatePresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const duplicateDoc = edit.createDoc(duplicatePresentation, { idPrefix: 'direct-background-duplicate-' });
  const duplicateEditor = new edit.Editor(duplicateDoc);
  const directId = duplicateDoc.slideOrder[0];
  let directDuplicateValid = false;
  let directDuplicateDetail = '';
  try {
    const firstCrop = { l: 0.11, t: 0.12, r: 0.13, b: 0.14 };
    const secondCrop = { l: 0.21, t: 0.22, r: 0.23, b: 0.24 };
    const thirdCrop = { l: 0.07, t: 0.08, r: 0.09, b: 0.1 };
    duplicateEditor.exec({ type: 'SetBackgroundCrop', id: directId, crop: firstCrop });
    const copiedId = [...duplicateEditor.exec({ type: 'DuplicateSlide', id: directId }).createdSlides][0];
    await duplicateEditor.saveDetailed();
    duplicateEditor.exec({ type: 'SetBackgroundCrop', id: directId, crop: secondCrop });
    await duplicateEditor.saveDetailed();
    duplicateEditor.exec({ type: 'SetBackground', id: directId, fill: null });
    duplicateEditor.exec({ type: 'SetBackgroundCrop', id: directId, crop: thirdCrop });
    const resaved = await duplicateEditor.saveDetailed();
    const duplicateReopened = await core.parse(resaved.bytes, { lazy: false, assets: 'defer' });
    directDuplicateValid = duplicateReopened.slides.length === 4
      && JSON.stringify(duplicateReopened.slides[0].background?.crop) === JSON.stringify(thirdCrop)
      && JSON.stringify(duplicateReopened.slides[1].background?.crop) === JSON.stringify(firstCrop)
      && duplicateDoc.slides[copiedId].backgroundImage.resourceHash
        === duplicateDoc.slides[directId].backgroundImage.resourceHash;
    duplicateReopened.dispose?.();
  } catch (error) { directDuplicateDetail = error instanceof Error ? error.message : String(error); }
  check('直接来源裁剪后可复制，保存后再次裁剪仍能重开等价',
    directDuplicateValid, directDuplicateDetail);
  edit.disposeDoc(duplicateDoc);
}
