import { makePng } from './ooxml.mjs';

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const JPEG_1PX = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==';
const GIF_1PX = 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const WEBP_1PX = 'UklGRhwAAABXRUJQVlA4TA8AAAAvAAAAAAcQ/Y/+ByKi/wEA';

const bytesOf = (base64) => Uint8Array.from(Buffer.from(base64, 'base64'));

const rejected = (fn) => {
  try { fn(); return false; } catch { return true; }
};

/** 图片插入只从公开命令、有效投影、选区与历史取证。 */
export async function runAddImageContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ AddImage 模型、投影与历史\x1b[0m');
  const input = load('sample-editor-add-shape.pptx');
  if (!check('找到可写图片插入基线固件', !!input)) return;
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'add-image-' });
  const editor = new edit.Editor(doc);
  const slideId = doc.slideOrder[0];
  const bytes = bytesOf(PNG_1PX);
  const result = editor.exec({
    type: 'AddImage', slideId, bytes, mime: 'image/png',
    rect: { x: 123.25, y: 67.5, w: 211.75, h: 109.5 },
  });
  const id = editor.selection.kind === 'elements' ? editor.selection.ids[0] : null;
  const record = id && doc.elements[id];
  const image = id && editor.effectiveElement(id);

  check('公开命令产生一个图片树 patch、自动选中新根并精确失效目标页',
    result.forward.length === 1 && result.inverse.length === 1
      && result.forward[0].op === 'insert' && result.forward[0].path.length === 2
      && result.dirtySlides.size === 1 && result.dirtySlides.has(slideId)
      && result.dirtyElements.has(id) && editor.history.undoCount === 1
      && editor.selection.kind === 'elements' && editor.selection.ids.join(',') === id);
  check('即时投影表达调用者给定的图片和矩形',
    record?.parent === slideId && record.meta.created && !!record.meta.insertion
      && image?.kind === 'image' && image.x === 123.25 && image.y === 67.5
      && image.w === 211.75 && image.h === 109.5 && image.rot === 0
      && image.crop === null && image.src === `data:image/png;base64,${PNG_1PX}`);

  bytes.fill(0);
  check('提交后修改调用者字节不会改变编辑文档',
    editor.effectiveElement(id).src === `data:image/png;base64,${PNG_1PX}`);
  editor.undo();
  check('撤销移除图片并恢复提交前选区', !doc.elements[id] && editor.selection.kind === 'none');
  editor.redo();
  check('重做恢复同一图片身份与像素来源', doc.elements[id]?.meta.origin?.spid === record.meta.origin.spid
    && editor.effectiveElement(id).src === `data:image/png;base64,${PNG_1PX}`
    && editor.selection.kind === 'elements' && editor.selection.ids[0] === id);
  editor.exec({ type: 'SetXfrm', id, x: 150.5, y: 90.25, w: 180, h: 120, rot: 12 });
  const transformed = editor.effectiveElement(id);
  check('新增图片无需特判即可使用既有移动、缩放和旋转命令', transformed.kind === 'image'
    && transformed.x === 150.5 && transformed.y === 90.25
    && transformed.w === 180 && transformed.h === 120 && transformed.rot === 12);
  editor.undo();
  check('撤销图片变换恢复插入矩形', editor.effectiveElement(id).x === 123.25
    && editor.effectiveElement(id).w === 211.75 && editor.effectiveElement(id).rot === 0);

  const formats = [
    ['image/jpeg', 'jpg', JPEG_1PX],
    ['image/gif', 'gif', GIF_1PX],
    ['image/webp', 'webp', WEBP_1PX],
  ];
  const formatIds = formats.map(([mime, extension, base64], index) => {
    editor.exec({
      type: 'AddImage', slideId, bytes: bytesOf(base64), mime,
      rect: { x: 30 + index * 50, y: 300, w: 40, h: 30 },
    });
    const formatId = editor.selection.ids[0];
    const inserted = doc.elements[formatId];
    check(`${mime} 经过真实格式识别并保留原始字节`,
      editor.effectiveElement(formatId).src === `data:${mime};base64,${base64}`
        && inserted.meta.insertion.resources[0].mime === mime
        && inserted.meta.insertion.resources[0].extension === extension);
    return formatId;
  });
  check('四种栅格图使用唯一元素和图片关系身份',
    new Set([id, ...formatIds]).size === 4
      && new Set([id, ...formatIds].map((imageId) =>
        doc.elements[imageId].meta.insertion.relationships[0].targetId)).size === 4);

  const copiedImage = edit.copyElements(doc, [id]);
  editor.exec({
    type: 'PasteElements', payload: copiedImage,
    at: { parentId: slideId, x: 420, y: 180 },
  });
  const pastedImageId = editor.selection.ids[0];
  check('新增图片立即复用既有跨实例剪贴板资源 token 与关系闭包',
    copiedImage.resources.length === 1
      && copiedImage.records[copiedImage.roots[0]].src.src
        === `web-ppt-resource:${copiedImage.resources[0].hash}`
      && editor.effectiveElement(pastedImageId).kind === 'image'
      && editor.effectiveElement(pastedImageId).src === `data:image/png;base64,${PNG_1PX}`);

  const beforeFailure = {
    identity: JSON.stringify(doc.identity),
    children: doc.slides[slideId].children.join(','),
    selection: JSON.stringify(editor.selection),
    history: editor.history.undoCount,
  };
  const pngSignatureOnly = bytesOf('iVBORw0KGgo=');
  const brokenPngChunks = bytesOf(PNG_1PX);
  brokenPngChunks.set([0x7f, 0xff, 0xff, 0xff], 33);
  const brokenGifBlocks = bytesOf(GIF_1PX);
  brokenGifBlocks[19] = 0;
  const emptyPng = new Uint8Array(45);
  emptyPng.set(bytesOf(PNG_1PX).subarray(0, 33));
  emptyPng.set(bytesOf(PNG_1PX).subarray(-12), 33);
  check('拒绝空字节、伪造或错配容器、未知 MIME、非法矩形和未知页面',
    rejected(() => editor.exec({
      type: 'AddImage', slideId, bytes: new Uint8Array(), mime: 'image/png',
      rect: { x: 0, y: 0, w: 10, h: 10 },
    }))
      && rejected(() => editor.exec({
        type: 'AddImage', slideId, bytes: pngSignatureOnly, mime: 'image/png',
        rect: { x: 0, y: 0, w: 10, h: 10 },
      }))
      && rejected(() => editor.exec({
        type: 'AddImage', slideId, bytes: brokenPngChunks, mime: 'image/png',
        rect: { x: 0, y: 0, w: 10, h: 10 },
      }))
      && rejected(() => editor.exec({
        type: 'AddImage', slideId, bytes: brokenGifBlocks, mime: 'image/gif',
        rect: { x: 0, y: 0, w: 10, h: 10 },
      }))
      && rejected(() => editor.exec({
        type: 'AddImage', slideId, bytes: emptyPng, mime: 'image/png',
        rect: { x: 0, y: 0, w: 10, h: 10 },
      }))
      && rejected(() => editor.exec({
        type: 'AddImage', slideId, bytes: bytesOf(PNG_1PX), mime: 'image/jpeg',
        rect: { x: 0, y: 0, w: 10, h: 10 },
      }))
      && rejected(() => editor.exec({
        type: 'AddImage', slideId, bytes: bytesOf(PNG_1PX), mime: 'image/svg+xml',
        rect: { x: 0, y: 0, w: 10, h: 10 },
      }))
      && rejected(() => editor.exec({
        type: 'AddImage', slideId, bytes: bytesOf(PNG_1PX), mime: 'image/png',
        rect: { x: NaN, y: 0, w: 0, h: 10 },
      }))
      && rejected(() => editor.exec({
        type: 'AddImage', slideId: 'missing-slide', bytes: bytesOf(PNG_1PX), mime: 'image/png',
        rect: { x: 0, y: 0, w: 10, h: 10 },
      })));
  check('图片命令失败不会推进身份、改变结构/选区或增加历史',
    JSON.stringify(doc.identity) === beforeFailure.identity
      && doc.slides[slideId].children.join(',') === beforeFailure.children
      && JSON.stringify(editor.selection) === beforeFailure.selection
      && editor.history.undoCount === beforeFailure.history);
  check('批量后段失败会回滚图片结构、资源闭包与全部身份水位', rejected(() => editor.exec(
    {
      type: 'AddImage', slideId, bytes: bytesOf(PNG_1PX), mime: 'image/png',
      rect: { x: 600, y: 300, w: 40, h: 30 },
    },
    { type: 'SetXfrm', id: 'missing-element', x: 10 },
  ))
    && JSON.stringify(doc.identity) === beforeFailure.identity
    && doc.slides[slideId].children.join(',') === beforeFailure.children
    && JSON.stringify(editor.selection) === beforeFailure.selection
    && editor.history.undoCount === beforeFailure.history);

  check('公开命令拒绝额外字段', rejected(() => editor.exec({
    type: 'AddImage', slideId, bytes: bytesOf(PNG_1PX),
    mime: 'image/png', rect: { x: 0, y: 0, w: 10, h: 10 }, extra: true,
  })));

  const largePresentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const largeDoc = edit.createDoc(largePresentation, { idPrefix: 'add-image-large-' });
  const largeEditor = new edit.Editor(largeDoc);
  const largeBytes = makePng(900, 900, (x, y) => {
    let value = Math.imul(x + 1, 1103515245) ^ Math.imul(y + 7, 2654435761);
    value ^= value >>> 13;
    return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255];
  });
  largeEditor.exec({
    type: 'AddImage', slideId: largeDoc.slideOrder[0], bytes: largeBytes, mime: 'image/png',
    rect: { x: 100, y: 100, w: 400, h: 400 },
  });
  check('2MB 图片只在一份历史资源闭包中计费且仍可撤销',
    largeBytes.length > 2 * 1024 * 1024 && largeEditor.history.undoCount === 1
      && largeEditor.history.byteSize < largeBytes.length * 1.5
      && !!largeEditor.undo() && largeEditor.history.redoCount === 1
      && !!largeEditor.redo() && largeEditor.history.undoCount === 1,
    `png=${largeBytes.length} history=${largeEditor.history.byteSize}`);
  edit.disposeDoc(largeDoc);

  const placeholderInput = load('sample-editor-add-slide.pptx');
  const placeholderPresentation = await core.parse(placeholderInput, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const placeholderDoc = edit.createDoc(placeholderPresentation, { idPrefix: 'add-image-placeholder-' });
  const placeholderEditor = new edit.Editor(placeholderDoc);
  const layoutId = placeholderDoc.layoutOrder.find((candidate) =>
    placeholderDoc.layouts[candidate].name === '标题和正文');
  const createdSlide = [...placeholderEditor.exec({
    type: 'AddSlide', layoutId, at: { after: placeholderDoc.slideOrder[0] },
  }).createdSlides][0];
  const placeholder = placeholderDoc.slides[createdSlide].children.map((child) => placeholderDoc.elements[child])
    .find((record) => record.meta.ph?.type === 'pic');
  placeholderEditor.select({ kind: 'elements', ids: [placeholder.id], enteredGroup: null });
  const replaced = placeholderEditor.exec({
    type: 'AddImage', slideId: createdSlide, placeholderId: placeholder.id,
    bytes: bytesOf(PNG_1PX), mime: 'image/png',
    rect: { x: 1040, y: 620, w: 120, h: 40 },
  });
  const replacementId = placeholderEditor.selection.ids[0];
  check('图片占位符在一个历史单元内被图片替换并自动选中新元素',
    replaced.forward.length === 2 && !placeholderDoc.elements[placeholder.id]
      && placeholderEditor.effectiveElement(replacementId).kind === 'image'
      && placeholderEditor.history.undoCount === 2);
  placeholderEditor.undo();
  check('撤销图片占位符替换会恢复同一占位符身份和原选区',
    !placeholderDoc.elements[replacementId] && placeholderDoc.elements[placeholder.id]
      && placeholderEditor.selection.kind === 'elements'
      && placeholderEditor.selection.ids[0] === placeholder.id);
  placeholderEditor.redo();
  check('重做图片占位符替换恢复同一图片身份和自动选区',
    !placeholderDoc.elements[placeholder.id] && placeholderDoc.elements[replacementId]
      && placeholderEditor.selection.kind === 'elements'
      && placeholderEditor.selection.ids[0] === replacementId);
  placeholderEditor.undo();
  const titlePlaceholder = placeholderDoc.slides[createdSlide].children
    .map((child) => placeholderDoc.elements[child]).find((record) => record.meta.ph?.type === 'title');
  const restoredPlaceholder = placeholderDoc.elements[placeholder.id];
  restoredPlaceholder.meta.locked = true;
  const lockedRejected = rejected(() => placeholderEditor.exec({
    type: 'AddImage', slideId: createdSlide, placeholderId: placeholder.id,
    bytes: bytesOf(PNG_1PX), mime: 'image/png', rect: { x: 0, y: 0, w: 10, h: 10 },
  }));
  restoredPlaceholder.meta.locked = false;
  check('拒绝跨页、非图片、锁定或不存在的占位符', lockedRejected
    &&
    rejected(() => placeholderEditor.exec({
      type: 'AddImage', slideId: placeholderDoc.slideOrder[0], placeholderId: placeholder.id,
      bytes: bytesOf(PNG_1PX), mime: 'image/png', rect: { x: 0, y: 0, w: 10, h: 10 },
    }))
      && rejected(() => placeholderEditor.exec({
        type: 'AddImage', slideId: createdSlide, placeholderId: titlePlaceholder.id,
        bytes: bytesOf(PNG_1PX), mime: 'image/png', rect: { x: 0, y: 0, w: 10, h: 10 },
      })));
  placeholderEditor.redo();
  edit.disposeDoc(placeholderDoc);

  const readonlyPresentation = await core.parse(input, { edit: true, lazy: false, assets: 'defer' });
  const readonlyDoc = edit.createDoc(readonlyPresentation, { idPrefix: 'add-image-readonly-' });
  const readonlyEditor = new edit.Editor(readonlyDoc);
  check('缺少可写 OOXML 包时拒绝新增图片', rejected(() => readonlyEditor.exec({
    type: 'AddImage', slideId: readonlyDoc.slideOrder[0], bytes: bytesOf(PNG_1PX), mime: 'image/png',
    rect: { x: 0, y: 0, w: 20, h: 20 },
  })));
  edit.disposeDoc(readonlyDoc);
  edit.disposeDoc(doc);
}
