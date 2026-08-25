import { makePng } from './ooxml.mjs';

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const MAX_REPLACEMENT_BYTES = 5 * 1024 * 1024;
const bytesOf = () => Uint8Array.from(Buffer.from(PNG_1PX, 'base64'));
const byName = (doc, name) => Object.values(doc.elements)
  .find((record) => record.src.name === name);
const rejected = (fn) => { try { fn(); return false; } catch { return true; } };
const noisyPng = (seed, size = 1050) => makePng(size, size, (x, y) => {
  let value = Math.imul(x + seed, 1103515245) ^ Math.imul(y + 17, 2654435761);
  value ^= value >>> 13;
  return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255];
});

/** 图片内容命令只从公开模型、查询、投影、历史与剪贴板闭包取证。 */
export async function runImageContentContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 图片替换与裁剪模型契约\x1b[0m');
  if (!check('发布入口公开图片裁剪查询', typeof edit.queryElementCrop === 'function')) return;
  const presentation = await core.parse(load('sample-editor-image-content.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'image-content-' });
  const editor = new edit.Editor(doc);
  const picture = byName(doc, 'image-external');
  if (!check('专用固件覆盖外链、四种格式、共享媒体与组合内图片',
    picture?.src.kind === 'image'
      && ['image-shared-a', 'image-jpeg', 'image-gif', 'image-webp', 'image-nested']
        .every((name) => byName(doc, name)?.src.kind === 'image')
      && byName(doc, 'image-shared-a').src.src === byName(doc, 'image-shared-b').src.src
      && byName(doc, 'image-nested').parent === byName(doc, 'image-group').id)) return;
  const source = editor.effectiveElement(picture.id);
  const sourceCrop = structuredClone(source.crop);
  const sourceSrc = source.src;

  const cropResult = editor.exec({
    type: 'SetCrop', id: picture.id,
    crop: { l: 0.123456, t: 0.2, r: 0.1, b: 0.05 },
  });
  const state = edit.queryElementCrop(doc, [picture.id]);
  check('SetCrop 量化到 DrawingML 精度并只失效图片及祖先',
    JSON.stringify(state.value) === JSON.stringify({ l: 0.12346, t: 0.2, r: 0.1, b: 0.05 })
      && state.direct && !state.mixed
      && cropResult.dirtyElements.has(picture.id)
      && JSON.stringify(editor.effectiveElement(picture.id).crop) === JSON.stringify(state.value));
  const noOp = editor.exec({
    type: 'SetCrop', id: picture.id,
    crop: { l: 0.12346, t: 0.2, r: 0.1, b: 0.05 },
  });
  check('同值裁剪严格 no-op', noOp.forward.length === 0
    && noOp.dirtyElements.size === 0 && editor.history.undoCount === 1);

  const replacement = bytesOf();
  const beforeFrame = (({ x, y, w, h, rot, flipH, flipV, crop, stroke, effects }) =>
    ({ x, y, w, h, rot, flipH, flipV, crop, stroke, effects }))(editor.effectiveElement(picture.id));
  editor.exec({ type: 'ReplaceImage', id: picture.id, bytes: replacement, mime: 'image/png' });
  replacement.fill(0);
  const replaced = editor.effectiveElement(picture.id);
  check('ReplaceImage 复制调用者字节并只替换像素来源',
    replaced.src === `data:image/png;base64,${PNG_1PX}`
      && JSON.stringify((({ x, y, w, h, rot, flipH, flipV, crop, stroke, effects }) =>
        ({ x, y, w, h, rot, flipH, flipV, crop, stroke, effects }))(replaced))
        === JSON.stringify(beforeFrame)
      && picture.meta.imageReplacement?.relationships.length === 1
      && !!doc.imageResources[picture.meta.imageReplacement?.resourceHash]);
  const replacementSrc = replaced.src;
  editor.undo();
  check('撤销替换恢复来源图片但保留先前裁剪',
    editor.effectiveElement(picture.id).src === sourceSrc
      && JSON.stringify(editor.effectiveElement(picture.id).crop) === JSON.stringify(beforeFrame.crop));
  editor.redo();
  check('重做替换恢复同一像素与关系身份', editor.effectiveElement(picture.id).src === replacementSrc);
  const replacementHistory = editor.history.undoCount;
  const replacementNoOp = editor.exec({
    type: 'ReplaceImage', id: picture.id, bytes: bytesOf(), mime: 'image/png',
  });
  check('同像素 ReplaceImage 严格 no-op', replacementNoOp.forward.length === 0
    && replacementNoOp.dirtyElements.size === 0 && editor.history.undoCount === replacementHistory);

  const copied = edit.copyElements(doc, [picture.id]);
  check('替换后的图片可跨实例复制且媒体闭包自包含',
    copied.resources.length === 1 && copied.resources[0].mime === 'image/png'
      && copied.records[copied.roots[0]].src.src === `web-ppt-resource:${copied.resources[0].hash}`);

  editor.exec({ type: 'SetCrop', id: picture.id, crop: null });
  check('null 恢复来源裁剪而全零形成直接无裁剪',
    JSON.stringify(edit.queryElementCrop(doc, [picture.id]).value) === JSON.stringify(sourceCrop)
      && !edit.queryElementCrop(doc, [picture.id]).direct);
  editor.exec({ type: 'SetCrop', id: picture.id, crop: { l: 0, t: 0, r: 0, b: 0 } });
  check('全零裁剪保留直接格式身份', edit.queryElementCrop(doc, [picture.id]).direct
    && JSON.stringify(edit.queryElementCrop(doc, [picture.id]).value)
      === JSON.stringify({ l: 0, t: 0, r: 0, b: 0 }));

  const sharedA = byName(doc, 'image-shared-a');
  const sharedB = byName(doc, 'image-shared-b');
  const explicitZero = byName(doc, 'image-jpeg');
  const inheritedPair = edit.queryElementCrop(doc, [sharedA.id, sharedB.id]);
  editor.exec({ type: 'SetCrop', id: sharedA.id, crop: { l: 0, t: 0, r: 0, b: 0 } });
  const mixedPair = edit.queryElementCrop(doc, [sharedA.id, sharedB.id]);
  check('多选裁剪查询区分相同继承值与 mixed 直接覆盖',
    !inheritedPair.mixed && !inheritedPair.direct && mixedPair.mixed && mixedPair.direct);
  check('确定性固件保留显式全零 srcRect',
    JSON.stringify(explicitZero.src.crop) === JSON.stringify({ l: 0, t: 0, r: 0, b: 0 }));
  editor.undo();

  const group = byName(doc, 'image-group');
  const atomicReplacement = makePng(2, 1, (x) => [x ? 240 : 20, 80, x ? 10 : 220]);
  const oversizedImage = noisyPng(47, 1350);
  const snapshot = JSON.stringify(doc);
  const history = editor.history.undoCount;
  check('非法裁剪、媒体目标、错配格式、额外字段与非法批量原子拒绝',
    rejected(() => editor.exec({
      type: 'SetCrop', id: picture.id, crop: { l: 0.6, t: 0, r: 0.4, b: 0 },
    }))
      && rejected(() => editor.exec({
        type: 'SetCrop', id: picture.id, crop: { l: Number.NaN, t: 0, r: 0, b: 0 },
      }))
      && rejected(() => editor.exec({ type: 'SetCrop', id: group.id, crop: null }))
      && rejected(() => editor.exec({
        type: 'ReplaceImage', id: picture.id, bytes: bytesOf(), mime: 'image/jpeg',
      }))
      && rejected(() => editor.exec({
        type: 'ReplaceImage', id: picture.id, bytes: bytesOf(), mime: 'image/png', extra: true,
      }))
      && rejected(() => editor.exec({
        type: 'ReplaceImage', id: picture.id,
        bytes: oversizedImage, mime: 'image/png',
      }))
      && rejected(() => editor.exec(
        { type: 'SetCrop', id: picture.id, crop: { l: 0.1, t: 0, r: 0, b: 0 } },
        { type: 'SetCrop', id: 'missing', crop: null },
      ))
      && rejected(() => editor.exec(
        { type: 'ReplaceImage', id: picture.id, bytes: atomicReplacement, mime: 'image/png' },
        { type: 'SetCrop', id: 'missing', crop: null },
      ))
      && oversizedImage.length > MAX_REPLACEMENT_BYTES
      && JSON.stringify(doc) === snapshot && editor.history.undoCount === history);

  const resourceCount = Object.keys(doc.imageResources).length;
  editor.exec({ type: 'ReplaceImage', id: sharedA.id, bytes: atomicReplacement, mime: 'image/png' });
  editor.exec({ type: 'ReplaceImage', id: sharedB.id, bytes: atomicReplacement, mime: 'image/png' });
  check('相同替换像素跨元素只登记一份文档资源但分配独立关系',
    Object.keys(doc.imageResources).length === resourceCount + 1
      && sharedA.meta.imageReplacement.resourceHash === sharedB.meta.imageReplacement.resourceHash
      && sharedA.meta.imageReplacement.relationships[0].targetId
        !== sharedB.meta.imageReplacement.relationships[0].targetId);

  const trackedResource = doc.imageResources[sharedA.meta.imageReplacement.resourceHash];
  const trackedBytes = trackedResource.bytes;
  let byteReads = 0;
  Object.defineProperty(trackedResource, 'bytes', {
    configurable: true, enumerable: true, get: () => { byteReads++; return trackedBytes; },
  });
  editor.exec({ type: 'SetCrop', id: picture.id, crop: { l: 0.02, t: 0, r: 0, b: 0 } });
  Object.defineProperty(trackedResource, 'bytes', {
    configurable: true, enumerable: true, writable: true, value: trackedBytes,
  });
  check('无关元素 Patch 不重复解码或哈希既有替换媒体', byteReads <= 1, `bytes reads=${byteReads}`);

  const extreme = { ...editor.effectiveElement(picture.id), crop: { l: 0.99999, t: 0, r: 0, b: 0 } };
  const extremeMarkup = core.renderElementToSvg(extreme, { idPrefix: 'extreme-crop-' }).markup;
  const renderedWidth = Number(/<image\b[^>]*\bwidth="([^"]+)"/.exec(extremeMarkup)?.[1]);
  check('合法极限裁剪按 DrawingML 十万分精度渲染',
    Math.abs(renderedWidth - extreme.w / 0.00001) < 1);

  const largeA = noisyPng(3);
  const largeB = noisyPng(29);
  editor.exec({ type: 'ReplaceImage', id: picture.id, bytes: largeA, mime: 'image/png' });
  const largeAHash = picture.meta.imageReplacement.resourceHash;
  editor.history.clear();
  editor.exec({ type: 'ReplaceImage', id: picture.id, bytes: largeB, mime: 'image/png' });
  const largeBHash = picture.meta.imageReplacement.resourceHash;
  check('连续大图替换按历史独占资源计费并仍可撤销',
    largeA.length < 5 * 1024 * 1024 && largeB.length < 5 * 1024 * 1024
      && editor.history.undoCount === 1
      && editor.history.byteSize > largeA.length
      && editor.history.byteSize <= 8 * 1024 * 1024,
    `a=${largeA.length} b=${largeB.length} history=${editor.history.byteSize}`);
  editor.exec({ type: 'ReplaceImage', id: picture.id, bytes: bytesOf(), mime: 'image/png' });
  const smallHash = picture.meta.imageReplacement.resourceHash;
  check('历史预算驱逐最老大图并回收其不可达资源',
    editor.history.undoCount === 1 && !doc.imageResources[largeAHash]
      && !!doc.imageResources[largeBHash] && !!doc.imageResources[smallHash]
      && !!editor.undo() && picture.meta.imageReplacement.resourceHash === largeBHash);
  editor.history.clear();
  check('清空历史只保留当前可达替换资源',
    !!doc.imageResources[largeBHash] && !doc.imageResources[smallHash]
      && !doc.imageResources[largeAHash]);
  edit.disposeDoc(doc);
}
