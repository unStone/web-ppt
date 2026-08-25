import { elementFrameToSlidePoint, queryElementCrop } from '/out/editor/editor.mjs';

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const bytesOf = () => Uint8Array.from(atob(PNG_1PX), (char) => char.charCodeAt(0));
const p95 = (samples) => {
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length * 0.95)];
};
const point = (pair) => { const [x, y] = pair.split(',').map(Number); return new DOMPoint(x, y); };
const center = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
const distance = (left, right) => Math.hypot(left.x - right.x, left.y - right.y);
const pointer = (type, position, pointerId) => new PointerEvent(type, {
  bubbles: true, composed: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
  pointerId, pointerType: 'mouse', isPrimary: true, clientX: position.x, clientY: position.y,
});

function mountElement() {
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  return mount;
}

function screenPoints(polygon) {
  const matrix = polygon.getScreenCTM();
  if (!matrix) throw new Error('Chrome 无法取得裁剪框屏幕矩阵');
  return polygon.getAttribute('points').trim().split(/\s+/)
    .map((pair) => point(pair).matrixTransform(matrix));
}

async function geometryContract(openEditor, load) {
  const mount = mountElement();
  const viewMount = mountElement();
  const session = await openEditor(await load('sample-editor-image-content.pptx'), {
    idPrefix: 'browser-image-crop-',
  });
  try {
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg', snapping: false });
    session.mount(viewMount, { mode: 'view', textMode: 'svg', snapping: false });
    const external = Object.values(session.editor.doc.elements)
      .find((record) => record.src.name === 'image-external');
    const target = mount.querySelector(`[data-edit-id="${external.id}"]`);
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }));
    if (!mount.querySelector(`[data-edit-crop-id="${external.id}"]`)
      || viewMount.querySelector('[data-edit-crop-id]')) {
      throw new Error('Chrome 双击图片没有遵守 edit/view 裁剪模式边界');
    }
    view.endImageCrop();
    const image = Object.values(session.editor.doc.elements)
      .find((record) => record.src.name === 'image-nested');
    if (!view.startImageCrop(image.id)) throw new Error('Chrome 无法编排组合内图片裁剪');
    session.editor.exec({
      type: 'SetCrop', id: image.id, crop: { l: 0.12, t: 0.08, r: 0.18, b: 0.14 },
    });
    session.editor.exec({ type: 'SetXfrm', id: image.id, rot: 27 });
    let geometryError = 0;
    let hitSizeError = 0;
    for (const zoom of [0.5, 1, 2]) {
      view.setZoom(zoom);
      const crop = queryElementCrop(session.editor.doc, [image.id]).value;
      const effective = session.editor.effectiveElement(image.id);
      const expectedSlide = [
        { x: 0, y: 0 }, { x: effective.w, y: 0 },
        { x: effective.w, y: effective.h }, { x: 0, y: effective.h },
      ].map((local) => elementFrameToSlidePoint(session.editor.doc, image.id, local));
      const sourceW = effective.w / (1 - crop.l - crop.r);
      const sourceH = effective.h / (1 - crop.t - crop.b);
      const expectedSourceSlide = [
        { x: -crop.l * sourceW, y: -crop.t * sourceH },
        { x: (1 - crop.l) * sourceW, y: -crop.t * sourceH },
        { x: (1 - crop.l) * sourceW, y: (1 - crop.t) * sourceH },
        { x: -crop.l * sourceW, y: (1 - crop.t) * sourceH },
      ].map((local) => elementFrameToSlidePoint(session.editor.doc, image.id, local));
      const overlay = mount.querySelector('[data-ppt-layer="interaction"]');
      const matrix = overlay.getScreenCTM();
      const expected = expectedSlide.map(({ x, y }) => new DOMPoint(x, y).matrixTransform(matrix));
      const expectedSource = expectedSourceSlide
        .map(({ x, y }) => new DOMPoint(x, y).matrixTransform(matrix));
      const actual = screenPoints(mount.querySelector('[data-edit-crop-frame]'));
      const actualSource = screenPoints(mount.querySelector('[data-edit-crop-source-frame]'));
      geometryError = Math.max(geometryError, ...actual.map((value, index) =>
        distance(value, expected[index])), ...actualSource.map((value, index) =>
        distance(value, expectedSource[index])));
      const visuals = [...mount.querySelectorAll('[data-edit-crop-handle]')]
        .map((node) => node.getBoundingClientRect());
      const hits = [...mount.querySelectorAll('[data-edit-crop-hit]')]
        .map((node) => node.getBoundingClientRect());
      hitSizeError = Math.max(hitSizeError, ...visuals.flatMap((rect) =>
        [Math.abs(rect.width - 8), Math.abs(rect.height - 8)]), ...hits.flatMap((rect) =>
        [Math.abs(rect.width - 16), Math.abs(rect.height - 16)]));
    }
    if (geometryError > 0.5 || hitSizeError > 0.5) {
      throw new Error(`Chrome 裁剪矩阵/命中偏差 ${geometryError.toFixed(3)}/${hitSizeError.toFixed(3)}px`);
    }
    view.setMode('view');
    if (mount.querySelector('[data-edit-crop-id]')
      || getComputedStyle(mount.querySelector('[data-ppt-layer="interaction"]')).display !== 'none') {
      throw new Error('Chrome view 模式泄漏裁剪辅助层');
    }
    return { geometryError, hitSizeError };
  } finally {
    session.dispose();
    mount.remove(); viewMount.remove();
  }
}

function measureFrames(mount, view) {
  const start = center(mount.querySelector('[data-edit-crop-hit="w"]').getBoundingClientRect());
  const pending = new Map();
  let serial = 0;
  const originalRequest = window.requestAnimationFrame;
  const originalCancel = window.cancelAnimationFrame;
  window.requestAnimationFrame = (callback) => { const id = ++serial; pending.set(id, callback); return id; };
  window.cancelAnimationFrame = (id) => pending.delete(id);
  const flush = () => {
    const entry = pending.entries().next().value;
    if (!entry || pending.size !== 1) throw new Error(`裁剪帧队列失控：${pending.size}`);
    pending.delete(entry[0]);
    const started = performance.now();
    entry[1](started);
    return performance.now() - started;
  };
  const samples = [];
  let end = { x: start.x + 4, y: start.y };
  try {
    mount.querySelector('[data-edit-crop-hit="w"]').dispatchEvent(pointer('pointerdown', start, 301));
    view.element.dispatchEvent(pointer('pointermove', end, 301));
    samples.push(flush());
    for (let index = 0; index < 80; index++) {
      end = { x: start.x + 10 + index % 5, y: start.y + index % 2 };
      view.element.dispatchEvent(pointer('pointermove', end, 301));
      samples.push(flush());
    }
    view.element.dispatchEvent(pointer('pointercancel', end, 301));
  } finally {
    window.requestAnimationFrame = originalRequest;
    window.cancelAnimationFrame = originalCancel;
  }
  return p95(samples);
}

async function performanceContract(openEditor, load) {
  const mount = mountElement();
  const session = await openEditor(await load('sample-editor-add-shape.pptx'), {
    idPrefix: 'browser-image-crop-perf-',
  });
  try {
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg', snapping: false });
    const slideId = view.slideId;
    const ids = [];
    for (let index = 0; index < 60; index++) {
      session.editor.exec({
        type: 'AddImage', slideId, bytes: bytesOf(), mime: 'image/png',
        rect: { x: 15 + index % 10 * 115, y: 15 + Math.floor(index / 10) * 105, w: 90, h: 70 },
      });
      ids.push(session.editor.selection.ids[0]);
    }
    const [id, siblingId] = ids;
    session.editor.select({ kind: 'elements', ids: [id], enteredGroup: null });
    if (!view.startImageCrop(id)) throw new Error('60 图片页无法进入裁剪模式');
    const sibling = mount.querySelector(`[data-edit-id="${siblingId}"]`);
    const svg = mount.querySelector('[data-ppt-layer="static"] svg');
    const samples = [];
    for (let index = 0; index < 80; index++) {
      const started = performance.now();
      session.editor.exec({
        type: 'SetCrop', id,
        crop: { l: index % 2 ? 0.11 : 0.12, t: 0.05, r: 0.08, b: 0.04 },
      });
      mount.querySelector('[data-edit-crop-frame]').getBoundingClientRect();
      samples.push(performance.now() - started);
    }
    const commitP95 = p95(samples);
    const historyBeforeFrame = session.editor.history.undoCount;
    const cropBeforeFrame = JSON.stringify(queryElementCrop(session.editor.doc, [id]).value);
    const frameP95 = measureFrames(mount, view);
    if (ids.length !== 60 || commitP95 > 16 || frameP95 > 8
      || mount.querySelector(`[data-edit-id="${siblingId}"]`) !== sibling
      || mount.querySelector('[data-ppt-layer="static"] svg') !== svg
      || session.editor.history.undoCount !== historyBeforeFrame
      || JSON.stringify(queryElementCrop(session.editor.doc, [id]).value) !== cropBeforeFrame) {
      throw new Error(`Chrome 60 图片裁剪提交/帧 p95 ${commitP95.toFixed(3)}/${frameP95.toFixed(3)}ms`);
    }
    return { commitP95, frameP95 };
  } finally {
    session.dispose();
    mount.remove();
  }
}

export async function runEditorImageCropBrowserContract({ openEditor, load }) {
  return { ...await geometryContract(openEditor, load), ...await performanceContract(openEditor, load) };
}

/** 主浏览器驱动只搬运一个自描述字段；指标命名和格式由能力契约自己拥有。 */
export function publishEditorImageCropBrowserResult(report, result) {
  report.dataset.imageCropReport = `图片裁剪偏差/命中 ${result.geometryError.toFixed(3)}/`
    + `${result.hitSizeError.toFixed(3)}px · 裁剪提交/帧 p95 ${result.commitP95.toFixed(3)}/`
    + `${result.frameP95.toFixed(3)}ms`;
}
