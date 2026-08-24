/** 浏览器矩阵是缩放幽灵的独立 oracle；这里不调用编辑器坐标函数来推导期望值。 */
const center = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
const distance = (left, right) => Math.hypot(left.x - right.x, left.y - right.y);
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const resizeHandles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const pointer = (type, point, pointerId) => new PointerEvent(type, {
  bubbles: true, composed: true, cancelable: true, pointerType: 'mouse', pointerId, isPrimary: true,
  button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: point.x, clientY: point.y,
});

function contractMount() {
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  return mount;
}

function renderedFrameMatrix(mount, id) {
  const target = mount.querySelector(`[data-edit-id="${id}"]`);
  const base = target?.querySelector(':scope > g[transform]');
  const matrix = base?.getScreenCTM();
  if (!target || !matrix) throw new Error(`无法取得缩放目标 ${id} 的浏览器矩阵`);
  return { target, matrix };
}

async function geometryContract(openEditor, load) {
  const mount = contractMount();
  const session = await openEditor(await load('sample-editor-space.pptx'), { idPrefix: 'browser-resize-' });
  try {
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg' });
    const record = Object.values(session.editor.doc.elements)
      .find((candidate) => candidate.src.name === 'space-rotated-flipped');
    let geometryError = 0;
    let hitSizeError = 0;
    for (const [index, zoom] of [0.5, 1, 2].entries()) {
      view.setZoom(zoom);
      session.editor.select({ kind: 'elements', ids: [record.id], enteredGroup: null });
      const { target, matrix } = renderedFrameMatrix(mount, record.id);
      const staticSvg = mount.querySelector('[data-ppt-layer="static"] svg');
      const defs = staticSvg.querySelector('defs');
      const startExpected = new DOMPoint(record.src.w, record.src.h).matrixTransform(matrix);
      const endExpected = new DOMPoint(record.src.w + 40, record.src.h + 30).matrixTransform(matrix);
      const anchorExpected = new DOMPoint(0, 0).matrixTransform(matrix);
      const visibleRect = mount.querySelector('[data-edit-handle="se"]').getBoundingClientRect();
      const hit = mount.querySelector('[data-edit-resize-handle="se"]');
      geometryError = Math.max(geometryError, distance(center(visibleRect), startExpected));
      const visibleRects = resizeHandles.map((handle) => mount
        .querySelector(`[data-edit-handle="${handle}"]`).getBoundingClientRect());
      const hitRects = resizeHandles.map((handle) => mount
        .querySelector(`[data-edit-resize-handle="${handle}"]`).getBoundingClientRect());
      hitSizeError = Math.max(hitSizeError,
        ...visibleRects.flatMap((rect) => [Math.abs(rect.width - 8), Math.abs(rect.height - 8)]),
        ...hitRects.flatMap((rect) => [Math.abs(rect.width - 16), Math.abs(rect.height - 16)]));
      hit.dispatchEvent(pointer('pointerdown', startExpected, 90 + index));
      view.element.dispatchEvent(pointer('pointermove', endExpected, 90 + index));
      await nextFrame();
      const previewHandle = center(mount.querySelector('[data-edit-handle="se"]').getBoundingClientRect());
      geometryError = Math.max(geometryError, distance(previewHandle, endExpected));
      if (!mount.querySelector('[data-edit-resize-ghost]')
        || mount.querySelector(`[data-edit-id="${record.id}"]`) !== target
        || mount.querySelector('[data-ppt-layer="static"] svg') !== staticSvg
        || staticSvg.querySelector('defs') !== defs
        || session.editor.effectiveElement(record.id).w !== record.src.w) {
        throw new Error(`zoom ${zoom} 缩放预览重建了静态 DOM 或写入模型`);
      }
      view.element.dispatchEvent(pointer('pointerup', endExpected, 90 + index));
      const committed = session.editor.effectiveElement(record.id);
      const committedMatrix = renderedFrameMatrix(mount, record.id).matrix;
      const anchorAfter = new DOMPoint(0, 0).matrixTransform(committedMatrix);
      geometryError = Math.max(geometryError, distance(anchorAfter, anchorExpected));
      const commitState = {
        frame: Math.abs(committed.w - 240) <= 1e-6 && Math.abs(committed.h - 170) <= 1e-6,
        history: session.editor.history.undoCount === 1,
        ghost: !mount.querySelector('[data-edit-resize-ghost]'),
      };
      if (!Object.values(commitState).every(Boolean)) {
        throw new Error(`zoom ${zoom} 缩放提交失败：${JSON.stringify(commitState)}`);
      }
      session.editor.undo();
    }
    const plain = Object.values(session.editor.doc.elements)
      .find((candidate) => candidate.src.name === 'space-plain');
    view.setZoom(1);
    session.editor.select({ kind: 'elements', ids: [plain.id], enteredGroup: null });
    const plainMatrix = renderedFrameMatrix(mount, plain.id).matrix;
    const crossingStart = new DOMPoint(plain.src.w, plain.src.h).matrixTransform(plainMatrix);
    const crossingEnd = new DOMPoint(-20, -10).matrixTransform(plainMatrix);
    const crossingAnchor = new DOMPoint(0, 0).matrixTransform(plainMatrix);
    mount.querySelector('[data-edit-resize-handle="se"]')
      .dispatchEvent(pointer('pointerdown', crossingStart, 99));
    view.element.dispatchEvent(pointer('pointermove', crossingEnd, 99));
    await nextFrame();
    const activeHandle = center(mount.querySelector('[data-edit-handle="se"]').getBoundingClientRect());
    const oppositeHandle = center(mount.querySelector('[data-edit-handle="nw"]').getBoundingClientRect());
    geometryError = Math.max(
      geometryError, distance(activeHandle, crossingEnd), distance(oppositeHandle, crossingAnchor),
    );
    view.element.dispatchEvent(pointer('pointerup', crossingEnd, 99));
    const crossed = session.editor.effectiveElement(plain.id);
    if (!crossed.flipH || !crossed.flipV || Math.abs(crossed.w - 20) > 1e-6
      || Math.abs(crossed.h - 10) > 1e-6) {
      throw new Error('过锚翻面时活动手柄没有连续跟随指针');
    }
    session.editor.undo();
    if (geometryError > 0.5 || hitSizeError > 0.5) {
      throw new Error(`缩放手柄/锚点误差 ${geometryError.toFixed(3)}/${hitSizeError.toFixed(3)}px`);
    }
    return { geometryError, hitSizeError };
  } finally {
    session.dispose();
    mount.remove();
  }
}

function measureResizeFrames(mount, view, { pointerId, endAt, finish = 'pointerup' }) {
  const start = center(mount.querySelector('[data-edit-resize-handle="se"]').getBoundingClientRect());
  const pending = new Map();
  let serial = 0;
  const originalRequest = window.requestAnimationFrame;
  const originalCancel = window.cancelAnimationFrame;
  window.requestAnimationFrame = (callback) => {
    const frame = ++serial;
    pending.set(frame, callback);
    return frame;
  };
  window.cancelAnimationFrame = (frame) => pending.delete(frame);
  const flush = () => {
    const entry = pending.entries().next().value;
    if (!entry || pending.size !== 1) throw new Error(`缩放帧队列失控：${pending.size}`);
    pending.delete(entry[0]);
    const started = performance.now();
    entry[1](started);
    return performance.now() - started;
  };
  const samples = [];
  let end = endAt(start, 0);
  try {
    mount.querySelector('[data-edit-resize-handle="se"]')
      .dispatchEvent(pointer('pointerdown', start, pointerId));
    view.element.dispatchEvent(pointer('pointermove', end, pointerId));
    samples.push(flush());
    for (let index = 0; index < 80; index++) {
      end = endAt(start, index + 1);
      view.element.dispatchEvent(pointer('pointermove', end, pointerId));
      samples.push(flush());
    }
    view.element.dispatchEvent(pointer(finish, end, pointerId));
  } finally {
    window.requestAnimationFrame = originalRequest;
    window.cancelAnimationFrame = originalCancel;
  }
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length * 0.95)];
}

async function performanceContract(openEditor, load) {
  const mount = contractMount();
  const session = await openEditor(await load('sample-editor-60.pptx'), { idPrefix: 'browser-resize-perf-' });
  try {
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg' });
    const [id, siblingId] = session.editor.doc.slides[view.slideId].children;
    session.editor.select({ kind: 'elements', ids: [id], enteredGroup: null });
    const target = mount.querySelector(`[data-edit-id="${id}"]`);
    const sibling = mount.querySelector(`[data-edit-id="${siblingId}"]`);
    const staticSvg = mount.querySelector('[data-ppt-layer="static"] svg');
    const defs = staticSvg.querySelector('defs');
    const source = session.editor.effectiveElement(id);
    const p95 = measureResizeFrames(mount, view, {
      pointerId: 101,
      endAt: (start, index) => ({
        x: start.x + (index ? 20 + index % 3 : 4),
        y: start.y + (index ? 16 + index % 2 : 4),
      }),
    });
    const committed = session.editor.effectiveElement(id);
    if (p95 > 8 || committed.w <= source.w || committed.h <= source.h
      || session.editor.history.undoCount !== 1
      || mount.querySelector('[data-edit-resize-ghost]')
      || mount.querySelector(`[data-edit-id="${id}"]`) === target
      || mount.querySelector(`[data-edit-id="${siblingId}"]`) !== sibling
      || mount.querySelector('[data-ppt-layer="static"] svg') !== staticSvg
      || staticSvg.querySelector('defs') !== defs) {
      throw new Error(`60 元素缩放帧 p95 ${p95.toFixed(3)}ms 或增量身份失败`);
    }
    session.editor.undo();

    const singularSlide = session.editor.doc.slideOrder[1];
    view.setSlide(singularSlide);
    const singularIds = session.editor.doc.slides[singularSlide].children;
    session.editor.select({ kind: 'elements', ids: singularIds, enteredGroup: null });
    const singularSources = singularIds.map((targetId) => session.editor.effectiveElement(targetId));
    const singularP95 = measureResizeFrames(mount, view, {
      pointerId: 102,
      finish: 'pointercancel',
      endAt: (start, index) => ({
        x: start.x + (index ? 40 + index % 3 : 4),
        y: start.y + (index ? 2 + index % 2 : 4),
      }),
    });
    const singularStable = singularIds.every((targetId, index) => {
      const current = session.editor.effectiveElement(targetId);
      return current.w === singularSources[index].w && current.h === singularSources[index].h
        && current.rot === singularSources[index].rot;
    });
    if (singularP95 > 8 || singularIds.length !== 60 || !singularStable
      || session.editor.history.undoCount !== 0 || mount.querySelector('[data-edit-resize-ghost]')) {
      throw new Error(`60 个 45° 元素近奇异缩放帧 p95 ${singularP95.toFixed(3)}ms 或取消恢复失败`);
    }
    return { p95, singularP95 };
  } finally {
    session.dispose();
    mount.remove();
  }
}

export async function runEditorResizeBrowserContract({ openEditor, load }) {
  const geometry = await geometryContract(openEditor, load);
  return { ...geometry, ...await performanceContract(openEditor, load) };
}
