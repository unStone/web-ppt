import { createHash } from 'node:crypto';
import { makeBmp, makePng } from './ooxml.mjs';

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const rejected = (fn) => { try { fn(); return false; } catch { return true; } };

/** 页面属性公开 seam：稳定页身份、来源/有效值、历史和渲染失效必须保持同一语义。 */
export async function runSlidePropertiesContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 页面矢量背景与隐藏状态\x1b[0m');
  if (!check('发布入口公开页面背景与隐藏查询',
    typeof edit.querySlideBackground === 'function'
      && typeof edit.querySlideHidden === 'function')) return;
  const presentation = await core.parse(load('sample-editor-slide-properties.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'slide-properties-' });
  const editor = new edit.Editor(doc);
  const [inheritedId, solidId, hiddenId, , , themeRefId] = doc.slideOrder;
  const inheritedSource = structuredClone(doc.slides[inheritedId].src.background);
  const sourceState = edit.querySlideBackground(doc, [inheritedId, solidId]);
  const hiddenSource = edit.querySlideHidden(doc, [inheritedId, hiddenId]);
  check('多页查询区分有效 mixed、来源 mixed 与直接覆盖',
    sourceState.mixed && sourceState.sourceMixed && !sourceState.direct
      && hiddenSource.value === false && hiddenSource.mixed
      && hiddenSource.source === false && hiddenSource.sourceMixed && !hiddenSource.direct);
  const themeRef = edit.querySlideBackground(doc, [themeRefId]);
  const explicitVisibleSource = edit.querySlideHidden(doc, [themeRefId]);
  check('主题色 bgRef 与 show=1 都解析为可编辑来源值',
    themeRef.value?.type === 'solid' && themeRef.value.color === 'rgb(112,173,71)'
      && !themeRef.direct && explicitVisibleSource.value === false
      && explicitVisibleSource.source === false && !explicitVisibleSource.direct);

  let lastChange;
  const unsubscribe = editor.subscribe((change) => { lastChange = change; });
  const backgroundResult = editor.exec({
    type: 'SetBackground', id: inheritedId,
    fill: { type: 'solid', color: '#334155' },
  });
  const background = edit.querySlideBackground(doc, [inheritedId]);
  check('SetBackground 只失效目标页并明确请求整页渲染',
    backgroundResult.dirtySlides.size === 1 && backgroundResult.dirtySlides.has(inheritedId)
      && backgroundResult.dirtyElements.size === 0
      && lastChange?.renderSlides.has(inheritedId)
      && background.value?.type === 'solid' && background.value.color === 'rgb(51,65,85)'
      && JSON.stringify(background.source) === JSON.stringify(inheritedSource)
      && background.direct && own(doc.slides[inheritedId].ovr, 'background'));

  const hiddenResult = editor.exec({ type: 'SetHidden', id: hiddenId, v: false });
  const visible = edit.querySlideHidden(doc, [hiddenId]);
  check('来源隐藏页可显式改回可见且不触发无意义 SVG 重建',
    hiddenResult.dirtySlides.has(hiddenId) && visible.value === false && visible.source === true
      && visible.direct && own(doc.slides[hiddenId].ovr, 'hidden')
      && lastChange?.renderSlides.size === 0);

  const historyBefore = editor.history.undoCount;
  editor.transaction((transaction) => {
    transaction.exec({ type: 'SetHidden', id: inheritedId, v: true });
    transaction.exec({ type: 'SetHidden', id: solidId, v: true });
  }, '隐藏两页');
  const undo = editor.undo();
  check('多页属性事务只形成一个可逆历史项',
    editor.history.undoCount === historyBefore
      && undo?.dirtySlides.has(inheritedId) && undo?.dirtySlides.has(solidId)
      && edit.querySlideHidden(doc, [inheritedId, solidId]).value === false);

  editor.exec({ type: 'SetBackground', id: inheritedId, fill: { type: 'none' } });
  const none = edit.querySlideBackground(doc, [inheritedId]);
  editor.exec({ type: 'SetBackground', id: inheritedId, fill: null });
  editor.exec({ type: 'SetHidden', id: hiddenId, v: null });
  check('显式无背景与恢复来源不同，null 同时恢复来源隐藏状态',
    none.value?.type === 'none' && none.direct
      && !own(doc.slides[inheritedId].ovr, 'background')
      && !own(doc.slides[hiddenId].ovr, 'hidden')
      && JSON.stringify(edit.toSlide(doc, inheritedId).background) === JSON.stringify(inheritedSource)
      && edit.toSlide(doc, hiddenId).hidden === true);

  const sameBackground = editor.exec({
    type: 'SetBackground', id: inheritedId, fill: inheritedSource,
  });
  const sameVisible = editor.exec({ type: 'SetHidden', id: solidId, v: false });
  check('与来源相同的非 null 值仍形成直接覆盖',
    sameBackground.forward.length === 1 && sameVisible.forward.length === 1
      && edit.querySlideBackground(doc, [inheritedId]).direct
      && edit.querySlideHidden(doc, [solidId]).direct);
  editor.exec({ type: 'SetBackground', id: inheritedId, fill: null });
  editor.exec({ type: 'SetHidden', id: solidId, v: null });

  const image = makePng(7, 5, (x, y) => [20 + x * 28, 15 + y * 37, (x * 19 + y * 31) % 256]);
  const imageResult = editor.exec({
    type: 'SetBackgroundImage', id: inheritedId, bytes: image, mime: 'image/png',
    crop: { l: 0.1, t: 0.05, r: 0.2, b: 0.15 }, alpha: 0.8,
  });
  const imageState = edit.querySlideBackground(doc, [inheritedId]);
  const imageHash = doc.slides[inheritedId].backgroundImage?.resourceHash;
  check('图片字节直接建立可渲染页面背景且历史只失效目标页',
    imageResult.dirtySlides.size === 1 && imageResult.dirtySlides.has(inheritedId)
      && imageResult.dirtyElements.size === 0 && imageResult.renderSlides.has(inheritedId)
      && imageState.value?.type === 'image' && imageState.value.src.startsWith('data:image/png;base64,')
      && JSON.stringify(imageState.value.crop) === JSON.stringify({ l: 0.1, t: 0.05, r: 0.2, b: 0.15 })
      && imageState.value.alpha === 0.8 && imageState.direct
      && typeof imageHash === 'string' && Object.keys(doc.imageResources).length === 1);
  editor.undo();
  const imageUndone = edit.querySlideBackground(doc, [inheritedId]);
  editor.redo();
  const imageRedone = edit.querySlideBackground(doc, [inheritedId]);
  check('图片背景撤销恢复来源，重做复用同一资源',
    JSON.stringify(imageUndone.value) === JSON.stringify(inheritedSource)
      && !imageUndone.direct && imageRedone.value?.type === 'image'
      && doc.slides[inheritedId].backgroundImage?.resourceHash === imageHash
      && Object.keys(doc.imageResources).length === 1);
  const duplicateUpload = editor.exec({
    type: 'SetBackgroundImage', id: solidId, bytes: image, mime: 'image/png',
  });
  check('不同页面上传相同字节复用唯一媒体资源',
    duplicateUpload.forward.every((patch) => patch.path[0] !== 'imageResources')
      && doc.slides[solidId].backgroundImage?.resourceHash === imageHash
      && Object.keys(doc.imageResources).length === 1);
  const cropResult = editor.exec({
    type: 'SetBackgroundCrop', id: inheritedId,
    crop: { l: 0.125, t: 0.2, r: 0.25, b: 0.1 },
  });
  const croppedBackground = edit.querySlideBackground(doc, [inheritedId]);
  check('图片背景裁剪复用媒体并只重建目标页',
    cropResult.forward.every((patch) => patch.path[0] !== 'imageResources')
      && cropResult.renderSlides.size === 1 && cropResult.renderSlides.has(inheritedId)
      && JSON.stringify(croppedBackground.value?.crop)
        === JSON.stringify({ l: 0.125, t: 0.2, r: 0.25, b: 0.1 })
      && doc.slides[inheritedId].backgroundImage?.resourceHash === imageHash
      && Object.keys(doc.imageResources).length === 1);
  editor.exec({ type: 'SetBackgroundCrop', id: inheritedId, crop: null });
  check('清除裁剪保留直接图片背景而非恢复页面来源',
    edit.querySlideBackground(doc, [inheritedId]).value?.type === 'image'
      && edit.querySlideBackground(doc, [inheritedId]).value?.crop === undefined
      && edit.querySlideBackground(doc, [inheritedId]).direct);
  editor.exec({ type: 'SetBackground', id: inheritedId, fill: null });
  editor.exec({ type: 'SetBackground', id: solidId, fill: null });

  const atomicBefore = JSON.stringify(doc);
  const historyAtomic = editor.history.undoCount;
  check('非法填充、非法布尔、缺页、额外字段与批量失败都原子拒绝',
    rejected(() => editor.exec({ type: 'SetBackground', id: inheritedId, fill: { type: 'image', src: 'data:' } }))
      && rejected(() => editor.exec({ type: 'SetBackground', id: inheritedId, fill: { type: 'solid', color: 'red' } }))
      && rejected(() => editor.exec({ type: 'SetHidden', id: hiddenId, v: 1 }))
      && rejected(() => editor.exec({ type: 'SetBackgroundCrop', id: inheritedId, crop: null }))
      && rejected(() => editor.exec({
        type: 'SetBackgroundImage', id: inheritedId, bytes: new Uint8Array(), mime: 'image/png',
      }))
      && rejected(() => editor.exec({
        type: 'SetBackgroundImage', id: inheritedId, bytes: image, mime: 'image/jpeg',
      }))
      && rejected(() => editor.exec({
        type: 'SetBackgroundImage', id: inheritedId, bytes: image, mime: 'image/png', alpha: 2,
      }))
      && rejected(() => editor.exec({
        type: 'SetBackgroundImage', id: inheritedId, bytes: image, mime: 'image/png',
        tile: { sx: 0, sy: 1, flip: 'none' },
      }))
      && rejected(() => editor.exec({
        type: 'SetBackgroundImage', id: inheritedId,
        bytes: new Uint8Array(edit.MAX_REPLACE_IMAGE_BYTES + 1), mime: 'image/png',
      }))
      && rejected(() => editor.exec({ type: 'SetHidden', id: 'missing', v: true }))
      && rejected(() => editor.exec({ type: 'SetHidden', id: hiddenId, v: true, extra: true }))
      && rejected(() => edit.applyPatches(doc, [{
        op: 'insert', path: ['slides', hiddenId, 'ovr', 'hidden'], origin: 'invalid',
      }]))
      && rejected(() => editor.exec(
        { type: 'SetHidden', id: inheritedId, v: true },
        { type: 'SetBackground', id: 'missing', fill: { type: 'none' } },
      ))
      && rejected(() => editor.exec(
        { type: 'SetHidden', id: solidId, v: true },
        { type: 'RemoveSlide', id: solidId },
      ))
      && JSON.stringify(doc) === atomicBefore && editor.history.undoCount === historyAtomic);
  unsubscribe();
  edit.disposeDoc(doc);

  const imagePresentation = await core.parse(load('sample-editor-slide-image-background.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const imageDoc = edit.createDoc(imagePresentation, { idPrefix: 'source-slide-background-' });
  const imageEditor = new edit.Editor(imageDoc);
  const [stretchId, tileId, inheritedImageId] = imageDoc.slideOrder;
  const uploadProbe = makePng(2, 2, (x, y) => [x * 97, y * 83, 211]);
  const uploadProbeHash = createHash('sha256').update(uploadProbe).digest('hex');
  Object.defineProperty(imageDoc.package.parts, 'ppt/media/scan-trap.bin', {
    configurable: true, enumerable: true,
    get() { throw new Error('白名单上传扫描了无关媒体'); },
  });
  let uploadProbeAccepted = false;
  try {
    edit.applyPatches(imageDoc, [{
      op: 'set', path: ['imageResources', uploadProbeHash], origin: 'remote',
      value: {
        targetPart: 'ppt/media/image999.png', hash: uploadProbeHash, mime: 'image/png',
        extension: 'png', bytes: Buffer.from(uploadProbe).toString('base64'), created: true,
      },
    }]);
    uploadProbeAccepted = true;
  } catch { /* 失败由断言报告。 */ }
  delete imageDoc.package.parts['ppt/media/scan-trap.bin'];
  if (uploadProbeAccepted) edit.applyPatches(imageDoc, [{
    op: 'del', path: ['imageResources', uploadProbeHash], origin: 'cleanup',
  }]);
  check('白名单 PNG 资源校验不扫描包内无关媒体', uploadProbeAccepted);
  let mismatchedTargetRejected = false;
  try {
    edit.applyPatches(imageDoc, [{
      op: 'set', path: ['imageResources', uploadProbeHash], origin: 'remote',
      value: {
        targetPart: 'ppt/media/forged.wav', hash: uploadProbeHash, mime: 'image/png',
        extension: 'png', bytes: Buffer.from(uploadProbe).toString('base64'), created: true,
      },
    }]);
  } catch { mismatchedTargetRejected = true; }
  if (!mismatchedTargetRejected) edit.applyPatches(imageDoc, [{
    op: 'del', path: ['imageResources', uploadProbeHash], origin: 'cleanup',
  }]);
  check('新媒体目标后缀必须与声明格式一致，不能把 PNG 写进现有 WAV Content-Type',
    mismatchedTargetRejected);
  const overrideSourcePackage = imageDoc.package;
  const overrideTarget = 'ppt/media/override-conflict.png';
  const contentTypes = new TextDecoder().decode(overrideSourcePackage.parts['[Content_Types].xml'])
    .replace('</Types>', `<Override PartName="/${overrideTarget}" ContentType="audio/wav"/></Types>`);
  imageDoc.package = {
    format: 'pptx', bytes: overrideSourcePackage.bytes, assets: overrideSourcePackage.assets,
    disposed: overrideSourcePackage.disposed,
    parts: {
      ...overrideSourcePackage.parts,
      '[Content_Types].xml': new TextEncoder().encode(contentTypes),
    },
  };
  let conflictingOverrideRejected = false;
  try {
    edit.applyPatches(imageDoc, [{
      op: 'set', path: ['imageResources', uploadProbeHash], origin: 'remote',
      value: {
        targetPart: overrideTarget, hash: uploadProbeHash, mime: 'image/png', extension: 'png',
        bytes: Buffer.from(uploadProbe).toString('base64'), created: true,
      },
    }]);
  } catch { conflictingOverrideRejected = true; }
  imageDoc.package = overrideSourcePackage;
  if (!conflictingOverrideRejected) edit.applyPatches(imageDoc, [{
    op: 'del', path: ['imageResources', uploadProbeHash], origin: 'cleanup',
  }]);
  check('目标尚无字节时仍拒绝与既有精确 Content-Type Override 冲突的媒体',
    conflictingOverrideRejected);
  const foreignBmp = makeBmp(2, 2, (x, y) => [x * 101, y * 79, 213 - x * 17 - y * 23]);
  const foreignHash = createHash('sha256').update(foreignBmp).digest('hex');
  check('扩展来源格式只信任当前 OPC 已有字节，远端 Patch 不能借 BMP 绕过上传白名单',
    rejected(() => edit.applyPatches(imageDoc, [{
      op: 'set', path: ['imageResources', foreignHash], origin: 'remote',
      value: {
        targetPart: 'ppt/media/foreign.bmp', hash: foreignHash, mime: 'image/bmp',
        extension: 'bmp', bytes: Buffer.from(foreignBmp).toString('base64'), created: true,
      },
    }])));
  const stretchSource = edit.querySlideBackground(imageDoc, [stretchId]);
  const tileSource = edit.querySlideBackground(imageDoc, [tileId]);
  const inheritedImageSource = edit.querySlideBackground(imageDoc, [inheritedImageId]);
  check('固件公开直接拉伸、平铺和版式继承图片背景来源',
    stretchSource.value?.type === 'image' && stretchSource.value.alpha === 0.72
      && JSON.stringify(stretchSource.value.crop)
        === JSON.stringify({ l: 0.08, t: 0.04, r: 0.12, b: 0.06 })
      && tileSource.value?.type === 'image'
      && JSON.stringify(tileSource.value.tile) === JSON.stringify({
        sx: 0.65, sy: 0.8, flip: 'xy', tx: 10, ty: -2, algn: 'ctr',
        sourceWidth: 96, sourceHeight: 54,
      })
      && inheritedImageSource.value?.type === 'image'
      && imagePresentation.package.assets?.[inheritedImageSource.value.src]?.mime === 'image/bmp'
      && JSON.stringify(inheritedImageSource.value.crop)
        === JSON.stringify({ l: 0.05, t: 0.1, r: 0.15, b: 0.2 })
      && !stretchSource.direct && !tileSource.direct && !inheritedImageSource.direct);
  imageEditor.exec({
    type: 'SetBackgroundCrop', id: stretchId,
    crop: { l: 0.2, t: 0.1, r: 0.15, b: 0.05 },
  });
  const inheritedCropPackage = imageDoc.package;
  let inheritedCropAvoidedPackageScan = false;
  try {
    imageDoc.package = {
      format: 'pptx', bytes: inheritedCropPackage.bytes, assets: inheritedCropPackage.assets,
      disposed: inheritedCropPackage.disposed,
      parts: new Proxy(inheritedCropPackage.parts, {
        ownKeys() { throw new Error('继承背景裁剪枚举了整个 OPC 包'); },
      }),
    };
    imageEditor.exec({
      type: 'SetBackgroundCrop', id: inheritedImageId,
      crop: { l: 0.1, t: 0.15, r: 0.2, b: 0.25 },
    });
    inheritedCropAvoidedPackageScan = true;
  } catch { /* 失败由断言报告，恢复原包后补建后续状态。 */ }
  imageDoc.package = inheritedCropPackage;
  if (!inheritedCropAvoidedPackageScan) imageEditor.exec({
    type: 'SetBackgroundCrop', id: inheritedImageId,
    crop: { l: 0.1, t: 0.15, r: 0.2, b: 0.25 },
  });
  check('继承图片背景首次裁剪只读取来源关系闭包，不枚举整个 OPC 包',
    inheritedCropAvoidedPackageScan);
  const bmpBytes = imageDoc.package.parts['ppt/media/inherited-background.bmp'];
  const bmpHash = createHash('sha256').update(bmpBytes).digest('hex');
  const originalStretchMetadata = structuredClone(imageDoc.slides[stretchId].backgroundImage);
  const forgedBmpToken = `web-ppt-resource:${bmpHash}`;
  const forgedBmpMetadata = {
    ...structuredClone(originalStretchMetadata),
    src: forgedBmpToken, resourceHash: bmpHash, resourceHashes: [bmpHash],
  };
  check('包内可信媒体必须绑定实际目标 part，不能让预览 BMP 而保存仍引用 PNG',
    rejected(() => edit.applyPatches(imageDoc, [{
      op: 'set', path: ['imageResources', bmpHash], origin: 'remote',
      value: {
        targetPart: 'ppt/media/slide-background.png', hash: bmpHash, mime: 'image/bmp',
        extension: 'bmp', bytes: Buffer.from(bmpBytes).toString('base64'), created: false,
      },
    }, {
      op: 'set', path: ['slides', stretchId, 'backgroundImage'],
      value: forgedBmpMetadata, origin: 'remote',
    }, {
      op: 'set', path: ['slides', stretchId, 'ovr', 'background'],
      value: { ...imageDoc.slides[stretchId].ovr.background, src: forgedBmpToken }, origin: 'remote',
    }])));
  const sourceResource = structuredClone(
    imageDoc.imageResources[originalStretchMetadata.resourceHash],
  );
  let forgedCreatedRejected = false;
  try {
    edit.applyPatches(imageDoc, [{
      op: 'set', path: ['imageResources', sourceResource.hash], origin: 'remote',
      value: { ...sourceResource, created: true },
    }]);
  } catch { forgedCreatedRejected = true; }
  if (!forgedCreatedRejected) edit.applyPatches(imageDoc, [{
    op: 'set', path: ['imageResources', sourceResource.hash], origin: 'cleanup', value: sourceResource,
  }]);
  check('created=true 只能占用真正的新媒体 part，不能覆写原包目标', forgedCreatedRejected);
  const directFill = structuredClone(imageDoc.slides[stretchId].ovr.background);
  const forgedDimensions = {
    ...directFill,
    tile: {
      sx: 1, sy: 1, flip: 'none', tx: 0, ty: 0, algn: 'tl',
      sourceWidth: 999, sourceHeight: 999,
    },
  };
  let forgedDimensionsRejected = false;
  try {
    edit.applyPatches(imageDoc, [{
      op: 'set', path: ['slides', stretchId, 'ovr', 'background'],
      value: forgedDimensions, origin: 'remote',
    }]);
  } catch { forgedDimensionsRejected = true; }
  if (!forgedDimensionsRejected) edit.applyPatches(imageDoc, [{
    op: 'set', path: ['slides', stretchId, 'ovr', 'background'],
    value: directFill, origin: 'cleanup',
  }]);
  check('平铺来源物理尺寸必须由真实图片与来源 DPI 推导，远端 Patch 不能伪造',
    forgedDimensionsRejected);
  const forgedReuse = structuredClone(imageDoc.slides[stretchId].backgroundImage);
  forgedReuse.relationships[0].sourceId = 'rId999';
  forgedReuse.relationships[0].targetId = 'rId999';
  forgedReuse.imageRelationshipId = 'rId999';
  check('远端 Patch 不能伪造“复用已有关系”来跳过关系 part 写入',
    rejected(() => edit.applyPatches(imageDoc, [{
      op: 'set', path: ['slides', stretchId, 'backgroundImage'],
      value: forgedReuse, origin: 'remote',
    }])));
  const inheritedMetadata = structuredClone(imageDoc.slides[inheritedImageId].backgroundImage);
  const forgedExternal = structuredClone(inheritedMetadata);
  const external = forgedExternal.relationships.find((relationship) => relationship.targetMode === 'External');
  external.target = 'https://attacker.invalid/forged';
  let forgedExternalRejected = false;
  try {
    edit.applyPatches(imageDoc, [{
      op: 'set', path: ['slides', inheritedImageId, 'backgroundImage'],
      value: forgedExternal, origin: 'remote',
    }]);
  } catch { forgedExternalRejected = true; }
  if (!forgedExternalRejected) edit.applyPatches(imageDoc, [{
    op: 'set', path: ['slides', inheritedImageId, 'backgroundImage'],
    value: inheritedMetadata, origin: 'cleanup',
  }]);
  check('继承背景的未知扩展关系必须来自真实来源闭包，不能由远端 Patch 改写',
    forgedExternalRejected);
  const duplicateResult = imageEditor.exec({ type: 'DuplicateSlide', id: stretchId });
  const duplicateId = [...duplicateResult.createdSlides][0];
  const duplicateEntry = imageEditor.history.undoEntries.at(-1);
  const forgedTree = structuredClone(duplicateEntry.forward.find((patch) =>
    patch.op === 'insert' && patch.path[0] === 'slides' && patch.path[1] === duplicateId));
  imageEditor.undo();
  forgedTree.value.slide.backgroundImage.sourcePart = 'ppt/slides/slide999.xml';
  const duplicateResourceHash = forgedTree.value.slide.backgroundImage.resourceHash;
  const duplicateResource = structuredClone(imageDoc.imageResources[duplicateResourceHash]);
  const treeAttackBefore = JSON.stringify({
    order: imageDoc.slideOrder,
    slides: imageDoc.slides,
    elements: imageDoc.elements,
    resources: imageDoc.imageResources,
    identity: imageDoc.identity,
  });
  let treeAttackRejected = false;
  try {
    edit.applyPatches(imageDoc, [{
      op: 'set', path: ['imageResources', duplicateResourceHash],
      value: duplicateResource, origin: 'remote',
    }, forgedTree]);
  } catch { treeAttackRejected = true; }
  if (!treeAttackRejected) edit.applyPatches(imageDoc, [{ ...forgedTree, op: 'remove' }]);
  check('远端页面树与资源组合补丁必须先验证完整模型，伪造来源失败时不插入任何状态',
    treeAttackRejected
      && JSON.stringify({
        order: imageDoc.slideOrder,
        slides: imageDoc.slides,
        elements: imageDoc.elements,
        resources: imageDoc.imageResources,
        identity: imageDoc.identity,
      }) === treeAttackBefore);
  check('PNG 直接来源与 BMP 版式来源均可首次裁剪并建立各自完整关系闭包',
    edit.querySlideBackground(imageDoc, [stretchId]).direct
      && edit.querySlideBackground(imageDoc, [inheritedImageId]).direct
      && imageDoc.slides[stretchId].backgroundImage?.resourceHash
        !== imageDoc.slides[inheritedImageId].backgroundImage?.resourceHash
      && imageDoc.imageResources[imageDoc.slides[inheritedImageId].backgroundImage?.resourceHash]
        ?.targetPart === 'ppt/media/inherited-background.bmp'
      && imageDoc.slides[inheritedImageId].backgroundImage?.relationships.length === 3
      && imageDoc.slides[inheritedImageId].backgroundImage?.resourceHashes.length === 2
      && Object.values(imageDoc.imageResources).some((resource) => resource.mime === 'audio/wav')
      && Object.keys(imageDoc.imageResources).length === 3);
  const sourcePackage = imageDoc.package;
  const packageParts = sourcePackage.parts;
  let uploadAvoidedPackageScan = false;
  try {
    imageDoc.package = {
      format: 'pptx', bytes: sourcePackage.bytes, assets: sourcePackage.assets,
      disposed: sourcePackage.disposed,
      parts: new Proxy(packageParts, {
        ownKeys() { throw new Error('背景上传扫描了整个 OPC 包'); },
      }),
    };
    imageEditor.exec({
      type: 'SetBackgroundImage', id: tileId, bytes: uploadProbe, mime: 'image/png',
    });
    uploadAvoidedPackageScan = true;
  } catch { /* 失败由断言报告，并在恢复真实 parts 后建立后续测试状态。 */ }
  imageDoc.package = sourcePackage;
  if (!uploadAvoidedPackageScan) imageEditor.exec({
    type: 'SetBackgroundImage', id: tileId, bytes: uploadProbe, mime: 'image/png',
  });
  check('公共背景上传只检查确定目标，不枚举或哈希整个 OPC 包', uploadAvoidedPackageScan);
  const forgedDpi = structuredClone(imageDoc.slides[tileId].backgroundImage);
  forgedDpi.preserveSourceDpi = true;
  check('上传背景是否保留来源 DPI 不能由远端 Patch 伪造',
    rejected(() => edit.applyPatches(imageDoc, [{
      op: 'set', path: ['slides', tileId, 'backgroundImage'], value: forgedDpi, origin: 'remote',
    }])));
  let duplicateCursor = stretchId;
  for (let index = 0; index < 16; index++) {
    const duplicated = imageEditor.exec({ type: 'DuplicateSlide', id: duplicateCursor });
    duplicateCursor = [...duplicated.createdSlides][0];
  }
  const indexedSlides = imageDoc.slides;
  let slideEnumerations = 0;
  imageDoc.slides = new Proxy(indexedSlides, {
    ownKeys(target) { slideEnumerations++; return Reflect.ownKeys(target); },
  });
  let indexedRelationshipValidation = false;
  try {
    edit.validateEditDoc(imageDoc);
    indexedRelationshipValidation = true;
  } catch { /* 失败由断言报告。 */ }
  imageDoc.slides = indexedSlides;
  check('大量复制页的关系来源校验预建 part 索引，不按宿主重复扫描全部页面',
    indexedRelationshipValidation && slideEnumerations < 12,
    `实际枚举 ${slideEnumerations} 次`);
  imageEditor.exec({ type: 'SetBackground', id: stretchId, fill: null });
  imageEditor.exec({ type: 'SetBackground', id: inheritedImageId, fill: null });
  check('来源图片裁剪重置后恢复各自直接或继承背景',
    JSON.stringify(edit.querySlideBackground(imageDoc, [stretchId]).value)
      === JSON.stringify(stretchSource.value)
      && JSON.stringify(edit.querySlideBackground(imageDoc, [inheritedImageId]).value)
        === JSON.stringify(inheritedImageSource.value)
      && !imageDoc.slides[stretchId].backgroundImage
      && !imageDoc.slides[inheritedImageId].backgroundImage);
  edit.disposeDoc(imageDoc);
}
