const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const WEBP_1PX = 'UklGRhwAAABXRUJQVlA4TA8AAAAvAAAAAAcQ/Y/+ByKi/wEA';
const bytesOf = () => Uint8Array.from(atob(PNG_1PX), (char) => char.charCodeAt(0));
const webpBytes = () => Uint8Array.from(atob(WEBP_1PX), (char) => char.charCodeAt(0));
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const p95 = (samples) => {
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length * 0.95)];
};

/** 真实 Chrome 覆盖文件 input、图片占位符、图片粘贴和完整 DOM 反馈。 */
export async function runEditorAddImageBrowserContract({ openEditor, load }) {
  const editMount = document.createElement('div');
  const viewMount = document.createElement('div');
  editMount.className = 'contract-offscreen';
  viewMount.className = 'contract-offscreen';
  document.body.append(editMount, viewMount);
  const session = await openEditor(await load('sample-editor-add-slide.pptx'), {
    idPrefix: 'browser-add-image-',
  });
  try {
    const editView = session.mount(editMount, { mode: 'edit', textMode: 'svg', zoom: 0.75, snapping: false });
    const viewView = session.mount(viewMount, { mode: 'view', textMode: 'svg', zoom: 0.75, snapping: false });
    const layoutId = session.editor.doc.layoutOrder.find((id) =>
      session.editor.doc.layouts[id].name === '标题和正文');
    const slideId = [...session.editor.exec({
      type: 'AddSlide', layoutId, at: { after: session.editor.doc.slideOrder[0] },
    }).createdSlides][0];
    editView.setSlide(slideId);
    viewView.setSlide(slideId);
    const placeholder = session.editor.doc.slides[slideId].children
      .map((id) => session.editor.doc.elements[id]).find((record) => record.meta.ph?.type === 'pic');
    const hit = editMount.querySelector(`[data-edit-placeholder-id="${placeholder.id}"]`);
    if (!hit || hit.dataset.editPlaceholderType !== 'pic' || viewMount.querySelector('[data-edit-placeholder-id]')) {
      throw new Error('图片占位符没有遵守 edit/view 辅助层边界');
    }

    hit.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }));
    await Promise.resolve();
    const input = editMount.querySelector('input[type="file"][data-web-ppt-image-input]');
    if (!input || input.accept !== 'image/png,image/jpeg,image/gif,image/webp') {
      throw new Error('双击图片占位符没有创建真实、格式受限的文件 input');
    }
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytesOf()], 'pixel.png', { type: 'image/png' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    for (let frameIndex = 0; frameIndex < 30 && editView.element.hasAttribute('aria-busy'); frameIndex++) {
      await nextFrame();
    }
    const selection = session.editor.selection;
    const imageId = selection.kind === 'elements' ? selection.ids[0] : null;
    const image = imageId && session.editor.effectiveElement(imageId);
    const frame = editMount.querySelector('[data-edit-selection-frame]')?.getBoundingClientRect();
    const stage = editMount.querySelector('[data-ppt-stage]').getBoundingClientRect();
    const geometryError = frame ? Math.max(
      Math.abs(frame.left - stage.left - 1040 * 0.75),
      Math.abs(frame.top - stage.top - 620 * 0.75),
      Math.abs(frame.width - 120 * 0.75),
      Math.abs(frame.height - 40 * 0.75),
    ) : Infinity;
    const feedback = {
      imageId, kind: image?.kind, geometryError,
      placeholderInModel: Boolean(session.editor.doc.elements[placeholder.id]),
      editImage: Boolean(editMount.querySelector(`[data-edit-id="${imageId}"] image`)),
      viewImage: Boolean(viewMount.querySelector(`[data-edit-id="${imageId}"] image`)),
      placeholderInDom: Boolean(editMount.querySelector(`[data-edit-placeholder-id="${placeholder.id}"]`)),
      busy: editView.element.hasAttribute('aria-busy'),
    };
    if (!imageId || image?.kind !== 'image' || geometryError > 0.5 || feedback.placeholderInModel
      || !feedback.editImage || !feedback.viewImage || feedback.placeholderInDom || feedback.busy) {
      throw new Error(`文件 input 未完成占位符替换/双视图反馈：${JSON.stringify(feedback)}`);
    }

    session.editor.undo();
    if (!session.editor.doc.elements[placeholder.id] || session.editor.doc.elements[imageId]
      || !editMount.querySelector(`[data-edit-placeholder-id="${placeholder.id}"]`)) {
      throw new Error('撤销没有恢复图片占位符和辅助入口');
    }
    session.editor.redo();
    if (!session.editor.doc.elements[imageId] || session.editor.selection.ids[0] !== imageId) {
      throw new Error('重做没有恢复同一图片与自动选区');
    }

    session.editor.exec({
      type: 'SetCrop', id: imageId, crop: { l: 0.1, t: 0.05, r: 0.15, b: 0.08 },
    });
    const replaceBefore = session.editor.effectiveElement(imageId);
    const viewImageBefore = viewMount.querySelector(`[data-edit-id="${imageId}"]`);
    await editView.replaceImage(new Blob([webpBytes()], { type: 'application/octet-stream' }));
    const replaced = session.editor.effectiveElement(imageId);
    if (!replaced.src.startsWith('data:image/webp;base64,')
      || JSON.stringify(replaced.crop) !== JSON.stringify(replaceBefore.crop)
      || replaced.x !== replaceBefore.x || replaced.y !== replaceBefore.y
      || viewMount.querySelector(`[data-edit-id="${imageId}"]`) === viewImageBefore) {
      throw new Error('Blob 图片替换没有保留几何/裁剪或同步 view 视图');
    }

    const historyBeforeCancel = session.editor.history.undoCount;
    const pendingCancel = editView.chooseImage();
    const cancelInput = editMount.querySelector('input[type="file"][data-web-ppt-image-input]');
    cancelInput.dispatchEvent(new Event('cancel'));
    if (await pendingCancel !== null || session.editor.history.undoCount !== historyBeforeCancel) {
      throw new Error('取消文件选择仍产生了图片或历史');
    }

    const errors = [];
    editView.element.addEventListener('webpptimageerror', (event) => errors.push(event.detail));
    let sizeRejected = false;
    try {
      await editView.insertImage(new Blob([bytesOf()]), { maxBytes: 8 });
    } catch (error) {
      sizeRejected = error.message.includes('8 字节');
    }
    let formatRejected = false;
    try {
      await editView.insertImage(new Blob([new Uint8Array(8)]), {
        maxBytes: 8, rect: { x: 10, y: 10, w: 10, h: 10 },
      });
    } catch (error) {
      formatRejected = error.message.includes('PNG、JPEG、GIF 或 WebP');
    }
    if (!sizeRejected || !formatRejected || errors.length !== 2
      || session.editor.history.undoCount !== historyBeforeCancel
      || editView.element.dataset.imageInsertState !== 'error') {
      throw new Error('图片大小/格式错误没有给出具体原因，或错误产生了历史副作用');
    }

    const directId = await editView.insertImage(
      new File([bytesOf()], 'direct.png', { type: 'application/octet-stream' }),
      { rect: { x: 760, y: 500, w: 96, h: 96 } },
    );
    if (session.editor.effectiveElement(directId).kind !== 'image'
      || session.editor.effectiveElement(directId).x !== 760) {
      throw new Error('自定义工具栏 Blob 没有按魔数汇入 AddImage');
    }

    const historyBeforeRace = session.editor.history.undoCount;
    let releaseRead;
    const pendingRead = editView.insertImage({
      size: bytesOf().length,
      arrayBuffer: () => new Promise((resolve) => { releaseRead = () => resolve(bytesOf().buffer); }),
    }, { rect: { x: 10, y: 10, w: 20, h: 20 } });
    await Promise.resolve();
    editView.setMode('view');
    releaseRead();
    let contextRejected = false;
    try { await pendingRead; } catch (error) { contextRejected = error.message.includes('查看模式'); }
    editView.setMode('edit');
    if (!contextRejected || session.editor.history.undoCount !== historyBeforeRace) {
      throw new Error('异步读图没有绑定发起时的 edit/slide 上下文');
    }

    const historyBeforePaste = session.editor.history.undoCount;
    const pasteData = new DataTransfer();
    pasteData.items.add(new File([bytesOf()], 'paste.png', { type: 'image/png' }));
    const accepted = editView.element.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true, composed: true, cancelable: true, clipboardData: pasteData,
    }));
    for (let frameIndex = 0; frameIndex < 10
      && session.editor.history.undoCount === historyBeforePaste; frameIndex++) await nextFrame();
    if (accepted || session.editor.history.undoCount !== historyBeforePaste + 1
      || session.editor.effectiveElement(session.editor.selection.ids[0]).kind !== 'image') {
      throw new Error('系统图片粘贴没有汇入同一 AddImage 历史闭环');
    }
    const pastedId = session.editor.selection.ids[0];
    const pastedBefore = session.editor.effectiveElement(pastedId);
    const pastedNode = editMount.querySelector(`[data-edit-id="${pastedId}"]`);
    session.editor.exec({ type: 'SetXfrm', id: pastedId, x: pastedBefore.x + 16, y: pastedBefore.y + 8 });
    if (session.editor.effectiveElement(pastedId).x !== pastedBefore.x + 16
      || editMount.querySelector(`[data-edit-id="${pastedId}"]`) === pastedNode
      || !viewMount.querySelector(`[data-edit-id="${pastedId}"] image`)) {
      throw new Error('Chrome 中粘贴图片没有复用既有移动命令和双视图增量反馈');
    }
    session.editor.undo();

    editView.setMode('view');
    let rejectedInView = false;
    try { await editView.insertImage(new Blob([bytesOf()], { type: 'image/png' })); } catch { rejectedInView = true; }
    if (!rejectedInView || editMount.querySelector('[data-edit-placeholder-id]')) {
      throw new Error('view 模式仍允许插入图片或泄漏编辑辅助节点');
    }
    return { geometryError };
  } finally {
    session.dispose();
    editMount.remove();
    viewMount.remove();
  }
}

export async function runEditorAddImagePerformanceContract({ openEditor, load }) {
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  const session = await openEditor(await load('sample-editor-60.pptx'), {
    idPrefix: 'browser-add-image-performance-',
  });
  try {
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg', snapping: false });
    const slideId = view.slideId;
    const siblingId = session.editor.doc.slides[slideId].children[0];
    const sibling = mount.querySelector(`[data-edit-id="${siblingId}"]`);
    const svg = mount.querySelector('[data-ppt-layer="static"] svg');
    const samples = [];
    for (let index = 0; index < 60; index++) {
      const started = performance.now();
      session.editor.exec({
        type: 'AddImage', slideId, bytes: bytesOf(), mime: 'image/png',
        rect: { x: 700 + index % 5, y: 500, w: 90, h: 60 },
      });
      mount.querySelector('[data-edit-selection-frame]')?.getBoundingClientRect();
      samples.push(performance.now() - started);
      session.editor.undo();
    }
    const feedbackP95 = p95(samples);
    if (feedbackP95 > 16 || session.editor.doc.slides[slideId].children.length !== 60
      || mount.querySelector('[data-ppt-layer="static"] svg') !== svg
      || mount.querySelector(`[data-edit-id="${siblingId}"]`) !== sibling) {
      throw new Error(`60 元素图片插入 p95 ${feedbackP95.toFixed(3)}ms 或 DOM 身份不稳定`);
    }
    return { p95: feedbackP95 };
  } finally {
    session.dispose();
    mount.remove();
  }
}
