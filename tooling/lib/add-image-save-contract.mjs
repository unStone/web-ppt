import { diffPackageBytes } from '../diff-package.mjs';
import { makePng } from './ooxml.mjs';

const WEBP_1PX = 'UklGRhwAAABXRUJQVlA4TA8AAAAvAAAAAAcQ/Y/+ByKi/wEA';
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const bytesOf = (base64) => Uint8Array.from(Buffer.from(base64, 'base64'));
const count = (source, needle) => source.split(needle).length - 1;

/** AddImage 保存只从公开命令、包差异、重开与独立进程渲染取证。 */
export async function runAddImageSaveContract({
  core, edit, load, check, eq, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ AddImage 媒体闭包、保留型保存与重开\x1b[0m');
  const scenario = Object.freeze({
    type: 'addImage', file: 'sample-editor-add-image.pptx', slideIndex: 0,
    images: [
      { part: 'ppt/media/image7.png', mime: 'image/png', rect: { x: 720, y: 90, w: 205, h: 135 } },
      { base64: WEBP_1PX, mime: 'image/webp', rect: { x: 720, y: 285, w: 160, h: 160 } },
      { base64: WEBP_1PX, mime: 'image/webp', rect: { x: 930, y: 285, w: 160, h: 160 } },
    ],
  });
  const input = load(scenario.file);
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'add-image-save-' });
  const editor = new edit.Editor(doc);
  const slideId = doc.slideOrder[0];
  const inserted = scenario.images.map((image) => {
    const bytes = image.part ? presentation.package.parts[image.part] : bytesOf(image.base64);
    editor.exec({ type: 'AddImage', slideId, bytes, mime: image.mime, rect: image.rect });
    return doc.elements[editor.selection.ids[0]];
  });
  check('包内同哈希图片不复制媒体，新 WebP 被两个元素共享',
    inserted[0].meta.insertion.resources[0].targetPart === 'ppt/media/image7.png'
      && inserted[0].meta.insertion.resources[0].created === false
      && inserted[1].meta.insertion.resources[0].targetPart === 'ppt/media/image1.webp'
      && inserted[1].meta.insertion.resources[0].created === true
      && inserted[2].meta.insertion.resources[0].targetPart === 'ppt/media/image1.webp'
      && inserted[2].meta.insertion.resources[0].hash === inserted[1].meta.insertion.resources[0].hash);
  check('高位和未知关系不会阻塞最小可用 rId 分配',
    inserted.map((record) => record.meta.insertion.relationships[0].targetId).join(',')
      === 'rId2,rId3,rId4');

  const projected = inserted.map((record) => editor.effectiveElement(record.id));
  const saved = await editor.saveDetailed();
  const artifact = saveArtifact('add-image.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  check('首次保存只增加一个去重媒体并改写目标 slide、rels 与 Content Types',
    diff.added.join(',') === 'ppt/media/image1.webp' && diff.removed.length === 0
      && diff.changed.join(',') === [
        '[Content_Types].xml', 'ppt/slides/_rels/slide1.xml.rels', 'ppt/slides/slide1.xml',
      ].join(','));

  const decode = (part) => new TextDecoder().decode(saved.package.parts[part]);
  const slideXml = decode('ppt/slides/slide1.xml');
  const relsXml = decode('ppt/slides/_rels/slide1.xml.rels');
  const typesXml = decode('[Content_Types].xml');
  const tailAt = slideXml.indexOf('{ADD-IMAGE-TAIL}');
  check('三个 p:pic 按 DrawingML sequence 插在未知尾节点之前并写入精确 EMU',
    count(slideXml, '<p:pic>') === 4
      && slideXml.indexOf(`name="${inserted[2].src.name}"`) < tailAt
      && slideXml.includes('<a:off x="6858000" y="857250"/>')
      && slideXml.includes('<a:ext cx="1952625" cy="1285875"/>')
      && count(slideXml, '<a:picLocks noChangeAspect="1"/>') === 3
      && slideXml.includes('<fixture:keep xmlns:fixture="urn:web-ppt:add-image" value="必须原位保留"/>'));
  check('关系与 Content Types 只追加唯一项并保留未知内容',
    relsXml.includes('Id="rId2"') && relsXml.includes('Target="../media/image7.png"')
      && relsXml.includes('Id="rId3"') && relsXml.includes('Id="rId4"')
      && count(relsXml, 'Target="../media/image1.webp"') === 2
      && relsXml.includes('Id="rId41" Type="urn:web-ppt:add-image:unknown"')
      && count(typesXml, 'Extension="webp" ContentType="image/webp"') === 1
      && typesXml.includes('PartName="/customXml/add-image.xml"'));
  check('新增媒体 part 与原始调用字节逐字节一致',
    Buffer.from(saved.package.parts['ppt/media/image1.webp']).equals(Buffer.from(bytesOf(WEBP_1PX))));

  const reopened = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedImages = reopened.slides[0].elements.filter((element) =>
    element.kind === 'image' && inserted.some((record) => record.src.name === element.name));
  check('保存重开恢复三张独立图片的身份、矩形和共享像素资源',
    reopenedImages.length === 3 && reopenedImages.every((image) => {
      const index = inserted.findIndex((record) => record.src.name === image.name);
      const expected = projected[index];
      return image.x === expected.x && image.y === expected.y
        && image.w === expected.w && image.h === expected.h && image.crop === null;
    }));

  const projectedFingerprint = renderFingerprint(scenario.file, 'projected', scenario);
  const savedFingerprint = renderFingerprint(artifact, 'saved', scenario);
  for (const mode of ['html', 'svg']) {
    eq(`新增图片保存产物 ${mode} 指纹等于独立进程有效投影`,
      savedFingerprint[mode], projectedFingerprint[mode]);
  }

  const savedAgain = await editor.saveDetailed();
  check('连续保存不重复 p:pic、关系、媒体或 Content Types 项',
    diffPackageBytes(saved.bytes, savedAgain.bytes).equal
      && count(new TextDecoder().decode(savedAgain.package.parts['ppt/slides/slide1.xml']), '<p:pic>') === 4
      && count(new TextDecoder().decode(savedAgain.package.parts['ppt/slides/_rels/slide1.xml.rels']),
        'Target="../media/image1.webp"') === 2);
  editor.undo();
  editor.undo();
  editor.undo();
  const restored = await editor.saveDetailed();
  check('保存后撤销三次会删除新媒体并逐字节恢复原包',
    diffPackageBytes(input, restored.bytes).equal);
  editor.redo();
  editor.redo();
  editor.redo();
  const redone = await editor.saveDetailed();
  check('重做恢复同一媒体闭包且不改变保存产物', diffPackageBytes(saved.bytes, redone.bytes).equal);

  const slideInput = load('sample-editor-add-slide.pptx');
  const slidePresentation = await core.parse(slideInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const slideDoc = edit.createDoc(slidePresentation, { idPrefix: 'add-image-new-slide-' });
  const slideEditor = new edit.Editor(slideDoc);
  const layoutId = slideDoc.layoutOrder.find((candidate) =>
    slideDoc.layouts[candidate].name === '标题和正文');
  const newSlideId = [...slideEditor.exec({
    type: 'AddSlide', layoutId, at: { after: slideDoc.slideOrder[0] },
  }).createdSlides][0];
  const picturePlaceholder = slideDoc.slides[newSlideId].children.map((id) => slideDoc.elements[id])
    .find((record) => record.meta.ph?.type === 'pic');
  slideEditor.exec({
    type: 'AddImage', slideId: newSlideId, placeholderId: picturePlaceholder.id,
    bytes: bytesOf(PNG_1PX), mime: 'image/png', rect: { x: 1040, y: 620, w: 120, h: 40 },
  });
  const newSlideImage = slideDoc.elements[slideEditor.selection.ids[0]];
  check('新增页保留 rId1 给版式并从 rId2 分配图片关系',
    newSlideImage.meta.insertion.relationships[0].targetId === 'rId2');
  const slideSaved = await slideEditor.saveDetailed();
  const newSlideXml = new TextDecoder().decode(slideSaved.package.parts['ppt/slides/slide8.xml']);
  const newSlideRels = new TextDecoder().decode(
    slideSaved.package.parts['ppt/slides/_rels/slide8.xml.rels'],
  );
  check('新增页保存原子替换图片占位符并合并版式/媒体关系',
    !newSlideXml.includes('<p:ph type="pic"') && newSlideXml.includes('<p:pic>')
      && newSlideRels.includes('Id="rId1"') && newSlideRels.includes('/slideLayout')
      && newSlideRels.includes('Id="rId2"') && newSlideRels.includes('/image'));

  const crossPresentation = await core.parse(slideInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const crossDoc = edit.createDoc(crossPresentation, { idPrefix: 'add-image-cross-slide-' });
  const crossEditor = new edit.Editor(crossDoc);
  const secondSlideId = [...crossEditor.exec({
    type: 'AddSlide', layoutId: crossDoc.layoutOrder[0], at: { after: crossDoc.slideOrder[0] },
  }).createdSlides][0];
  const crossImages = [
    { slideId: crossDoc.slideOrder[0], bytes: bytesOf(PNG_1PX) },
    { slideId: secondSlideId, bytes: makePng(1, 1, () => [255, 0, 0]) },
    { slideId: secondSlideId, bytes: bytesOf(PNG_1PX) },
  ].map((image, index) => {
    crossEditor.exec({
      type: 'AddImage', ...image, mime: 'image/png',
      rect: { x: 50 + index * 100, y: 50, w: 80, h: 80 },
    });
    return crossDoc.elements[crossEditor.selection.ids[0]];
  });
  check('跨页同哈希 PNG 复用媒体，不同 PNG 在文档级分配唯一 part',
    crossImages[0].meta.insertion.resources[0].targetPart
      === crossImages[2].meta.insertion.resources[0].targetPart
      && new Set(crossImages.map((record) => record.meta.insertion.resources[0].targetPart)).size === 2);
  const crossSaved = await crossEditor.saveDetailed();
  const crossReopened = await core.parse(crossSaved.bytes, { edit: true, lazy: false, assets: 'defer' });
  check('跨页图片保存不会争用媒体 part 且可无修复重开', crossReopened.slides.length === 2
    && crossReopened.slides[0].elements.some((element) => element.kind === 'image')
    && crossReopened.slides[1].elements.filter((element) => element.kind === 'image').length === 2
    && crossReopened.slides[1].elements.some((element) => element.kind === 'image'
      && element.src === crossReopened.slides[0].elements.find((item) => item.kind === 'image')?.src),
  `slides=${crossReopened.slides.length} images=${crossReopened.slides
    .map((slide) => slide.elements.filter((element) => element.kind === 'image').length).join(',')}`);

  reopened.dispose?.();
  crossReopened.dispose?.();
  edit.disposeDoc(crossDoc);
  edit.disposeDoc(slideDoc);
  edit.disposeDoc(doc);
  return { artifact };
}
