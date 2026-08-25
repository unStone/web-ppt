const modelJson = (doc) => JSON.stringify({
  meta: doc.meta,
  identity: doc.identity,
  slides: doc.slides,
  slideOrder: doc.slideOrder,
  layouts: doc.layouts,
  layoutOrder: doc.layoutOrder,
  elements: doc.elements,
  removedElements: doc.removedElements,
  imageResources: doc.imageResources,
});

const rejected = (fn) => {
  try { fn(); return false; } catch { return true; }
};

const imagesOf = (elements) => elements.flatMap((element) => [
  ...(element.kind === 'image' ? [element] : []),
  ...(element.kind === 'group' ? imagesOf(element.children) : []),
]);

/** URL 只属于一次解析会话；恢复日志必须携带可在新会话重建的资源闭包。 */
export async function runRecoveryAssetContract({ edit, core, load, check }) {
  const assetInput = load('sample-editor-image-content.pptx');
  const assetPresentation = await core.parse(assetInput, { edit: true, keepPackage: true, lazy: false });
  const assetDoc = edit.createDoc(assetPresentation, { idPrefix: 'recovery-assets-' });
  const assetEditor = new edit.Editor(assetDoc);
  const assetSlide = assetDoc.slideOrder[0];
  const sourceImage = Object.values(assetDoc.elements).find((record) =>
    record.src.kind === 'image' && record.src.src.startsWith('blob:'));
  const assetFrames = [];
  const stopAssets = assetEditor.subscribeRecovery((frame) => assetFrames.push(frame));
  const duplicatedAsset = assetEditor.exec({ type: 'DuplicateSlide', id: assetSlide });
  const duplicatedAssetSlide = [...duplicatedAsset.createdSlides][0];
  stopAssets();
  const oldAssetUrl = sourceImage?.src.src;
  const assetLog = JSON.parse(JSON.stringify(assetFrames));
  check('结构恢复帧显式记录会话资源的原包身份', !!oldAssetUrl
    && assetLog.some((frame) => frame.assets?.some((asset) =>
      asset.url === oldAssetUrl && typeof asset.sourcePart === 'string')));
  edit.disposeDoc(assetDoc);

  const freshAssetPresentation = await core.parse(assetInput, {
    edit: true, keepPackage: true, lazy: false,
  });
  const freshAssetDoc = edit.createDoc(freshAssetPresentation, { idPrefix: 'recovery-assets-' });
  const freshAssetEditor = new edit.Editor(freshAssetDoc, { recoveryFrames: assetLog });
  const restoredImage = freshAssetEditor.toSlide(duplicatedAssetSlide).elements.find((element) =>
    element.kind === 'image' && !!freshAssetDoc.package.assets?.[element.src]);
  check('重开时把失效 blob URL 重新绑定到新解析会话的同一 OPC 资源',
    restoredImage?.kind === 'image' && restoredImage.src !== oldAssetUrl
      && restoredImage.src.startsWith('blob:')
      && !!freshAssetDoc.package.assets?.[restoredImage.src]
      && !JSON.stringify(freshAssetDoc.slides[duplicatedAssetSlide]).includes(oldAssetUrl));
  const missingAssetLog = structuredClone(assetLog);
  for (const frame of missingAssetLog) delete frame.assets;
  const missingAssetPresentation = await core.parse(assetInput, {
    edit: true, keepPackage: true, lazy: false,
  });
  const missingAssetDoc = edit.createDoc(missingAssetPresentation, { idPrefix: 'recovery-assets-' });
  const missingAssetBefore = modelJson(missingAssetDoc);
  check('删除资源闭包后日志被拒绝且不会提交失效会话 URL',
    rejected(() => edit.restoreRecoveryFrames(missingAssetDoc, missingAssetLog))
      && modelJson(missingAssetDoc) === missingAssetBefore);
  edit.disposeDoc(missingAssetDoc);

  const legacyInput = load('showcase.ppt');
  const legacyPresentation = await core.parse(legacyInput, { edit: true, lazy: false });
  const legacyDoc = edit.createDoc(legacyPresentation, { idPrefix: 'recovery-ppt-assets-' });
  const legacyEditor = new edit.Editor(legacyDoc);
  const legacyImage = Object.values(legacyDoc.elements).find((record) =>
    record.src.kind === 'image' && record.src.src.startsWith('blob:'));
  const legacyFrames = [];
  const stopLegacy = legacyEditor.subscribeRecovery((frame) => legacyFrames.push(frame));
  if (legacyImage) {
    legacyEditor.exec({ type: 'RemoveElement', id: legacyImage.id });
    legacyEditor.undo();
  }
  stopLegacy();
  const oldLegacyUrl = legacyImage?.src.src;
  const legacyLog = JSON.parse(JSON.stringify(legacyFrames));
  check('.ppt 结构恢复帧内嵌位图字节而不是持久化失效 blob URL', !!oldLegacyUrl
    && legacyLog.some((frame) => frame.assets?.some((asset) =>
      asset.url === oldLegacyUrl && typeof asset.data === 'string' && !asset.sourcePart)));
  edit.disposeDoc(legacyDoc);

  const freshLegacyPresentation = await core.parse(legacyInput, { edit: true, lazy: false });
  const freshLegacyDoc = edit.createDoc(freshLegacyPresentation, { idPrefix: 'recovery-ppt-assets-' });
  const freshLegacyEditor = new edit.Editor(freshLegacyDoc, { recoveryFrames: legacyLog });
  const restoredLegacyImages = freshLegacyDoc.slideOrder.flatMap((id) =>
    imagesOf(freshLegacyEditor.toSlide(id).elements));
  check('.ppt 重开后从日志字节恢复位图且元素不引用旧会话 URL',
    restoredLegacyImages.some((image) => image.src.startsWith('data:image/'))
      && !JSON.stringify(freshLegacyDoc.elements[legacyImage?.id] ?? null).includes(oldLegacyUrl));

  const validationLegacyPresentation = await core.parse(legacyInput, { edit: true, lazy: false });
  const validationLegacyBase = edit.createDoc(validationLegacyPresentation, {
    idPrefix: 'recovery-ppt-assets-',
  });
  const invalidAssetData = structuredClone(legacyLog);
  invalidAssetData.find((frame) => frame.assets?.some((asset) => asset.data))
    .assets.find((asset) => asset.data).data = 'A';
  const invalidAssetMime = structuredClone(legacyLog);
  invalidAssetMime.find((frame) => frame.assets?.some((asset) => asset.data))
    .assets.find((asset) => asset.data).mime = 'image/png;base64';
  const invalidDataDoc = structuredClone(validationLegacyBase);
  const invalidMimeDoc = structuredClone(validationLegacyBase);
  const legacyValidationBefore = modelJson(validationLegacyBase);
  check('非规范 Base64 与非法 MIME 的恢复资源都被原子拒绝',
    rejected(() => edit.restoreRecoveryFrames(invalidDataDoc, invalidAssetData))
      && rejected(() => edit.restoreRecoveryFrames(invalidMimeDoc, invalidAssetMime))
      && modelJson(invalidDataDoc) === legacyValidationBefore
      && modelJson(invalidMimeDoc) === legacyValidationBefore);

  edit.disposeDoc(validationLegacyBase);
  edit.disposeDoc(freshLegacyDoc);
  edit.disposeDoc(freshAssetDoc);
}
