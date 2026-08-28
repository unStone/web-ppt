/** Chrome 的 getScreenCTM 是旋转幽灵的独立 oracle，避免用编辑器坐标函数证明自己。 */
import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const center = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
const distance = (left, right) => Math.hypot(left.x - right.x, left.y - right.y);
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const pointer = (type, point, pointerId) => new PointerEvent(type, {
  bubbles: true, composed: true, cancelable: true, pointerType: 'mouse', pointerId, isPrimary: true,
  button: 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
  clientX: point.x, clientY: point.y,
});

function contractMount() {
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  return mount;
}

function rotatePoint(point, origin, degrees) {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = point.x - origin.x;
  const y = point.y - origin.y;
  return { x: origin.x + cos * x - sin * y, y: origin.y + sin * x + cos * y };
}

function renderedTarget(mount, id) {
  const target = mount.querySelector(`[data-edit-id="${id}"]`);
  const base = target?.querySelector(':scope > g[transform]');
  const matrix = base?.getScreenCTM();
  if (!target || !base || !matrix) throw new Error(`无法取得旋转目标 ${id} 的浏览器矩阵`);
  return { target, base, matrix };
}

function screenCorners(matrix, frame) {
  return [
    new DOMPoint(0, 0), new DOMPoint(frame.w, 0),
    new DOMPoint(frame.w, frame.h), new DOMPoint(0, frame.h),
  ].map((point) => point.matrixTransform(matrix));
}

function expectedFrameCorners(parentMatrix, frame) {
  const centerInParent = { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
  return [
    { x: frame.x, y: frame.y }, { x: frame.x + frame.w, y: frame.y },
    { x: frame.x + frame.w, y: frame.y + frame.h }, { x: frame.x, y: frame.y + frame.h },
  ].map((point) => rotatePoint(point, centerInParent, frame.rot))
    .map((point) => new DOMPoint(point.x, point.y).matrixTransform(parentMatrix));
}

function pointError(actual, expected) {
  return Math.max(...actual.map((point, index) => distance(point, expected[index])));
}

async function nestedGeometryContract(openEditor, load) {
  const mount = contractMount();
  const session = await openEditor(await load('sample-editor-space.pptx'), { idPrefix: 'browser-rotate-' });
  try {
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg' });
    const record = Object.values(session.editor.doc.elements)
      .find((candidate) => candidate.src.name === 'space-nested-leaf');
    let geometryError = 0;
    for (const [index, zoom] of [0.5, 1, 2].entries()) {
      view.setZoom(zoom);
      session.editor.select({ kind: 'elements', ids: [record.id], enteredGroup: record.parent });
      const before = renderedTarget(mount, record.id);
      const parentMatrix = before.target.parentElement.getScreenCTM();
      const handle = mount.querySelector('[data-edit-rotation-handle]');
      const start = center(handle.getBoundingClientRect());
      const parentStart = new DOMPoint(start.x, start.y).matrixTransform(parentMatrix.inverse());
      const parentCenter = { x: record.src.x + record.src.w / 2, y: record.src.y + record.src.h / 2 };
      const parentEnd = rotatePoint(parentStart, parentCenter, 37);
      const end = new DOMPoint(parentEnd.x, parentEnd.y).matrixTransform(parentMatrix);
      const expected = expectedFrameCorners(parentMatrix, { ...record.src, rot: 52 });
      const staticSvg = mount.querySelector('[data-ppt-layer="static"] svg');
      const defs = staticSvg.querySelector('defs');
      handle.dispatchEvent(pointer('pointerdown', start, 120 + index));
      view.element.dispatchEvent(pointer('pointermove', end, 120 + index));
      await nextFrame();
      const preview = renderedTarget(mount, record.id);
      geometryError = Math.max(geometryError, pointError(screenCorners(preview.matrix, record.src), expected));
      if (!mount.querySelector('[data-edit-rotation-ghost]')
        || mount.querySelector(`[data-edit-id="${record.id}"]`) !== before.target
        || mount.querySelector('[data-ppt-layer="static"] svg') !== staticSvg
        || staticSvg.querySelector('defs') !== defs
        || session.editor.effectiveElement(record.id).rot !== record.src.rot) {
        throw new Error(`zoom ${zoom} 旋转预览重建了静态 DOM 或写入模型`);
      }
      view.element.dispatchEvent(pointer('pointerup', end, 120 + index));
      const committed = session.editor.effectiveElement(record.id);
      const committedTarget = renderedTarget(mount, record.id);
      geometryError = Math.max(
        geometryError, pointError(screenCorners(committedTarget.matrix, record.src), expected),
      );
      if (Math.abs(committed.rot - 52) > 1e-6 || session.editor.history.undoCount !== 1
        || mount.querySelector('[data-edit-rotation-ghost]')) {
        throw new Error(`zoom ${zoom} 嵌套旋转没有单事务提交`);
      }
      session.editor.undo();
    }
    if (geometryError > 0.5) throw new Error(`嵌套旋转幽灵角度/中心偏差 ${geometryError.toFixed(3)}px`);
    return geometryError;
  } finally {
    session.dispose();
    mount.remove();
  }
}

async function multiGeometryContract(openEditor, load) {
  const mount = contractMount();
  const session = await openEditor(await load('sample-editor-space.pptx'), { idPrefix: 'browser-multi-rotate-' });
  try {
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg' });
    const byName = (name) => Object.values(session.editor.doc.elements)
      .find((candidate) => candidate.src.name === name);
    const records = [byName('space-plain'), byName('space-rotated-flipped')];
    let geometryError = 0;
    for (const [index, zoom] of [0.5, 1, 2].entries()) {
      view.setZoom(zoom);
      session.editor.select({
        kind: 'elements', ids: records.map((record) => record.id), enteredGroup: null,
      });
      const frameRect = mount.querySelector('[data-edit-selection-frame]').getBoundingClientRect();
      const selectionCenter = center(frameRect);
      const handle = mount.querySelector('[data-edit-rotation-handle]');
      const start = center(handle.getBoundingClientRect());
      const end = rotatePoint(start, selectionCenter, 37);
      const before = records.map((record) => ({ record, ...renderedTarget(mount, record.id) }));
      const expected = before.map(({ record, matrix }) =>
        screenCorners(matrix, record.src).map((point) => rotatePoint(point, selectionCenter, 37)));
      handle.dispatchEvent(pointer('pointerdown', start, 130 + index));
      view.element.dispatchEvent(pointer('pointermove', end, 130 + index));
      await nextFrame();
      geometryError = Math.max(geometryError, ...before.map(({ record }, targetIndex) => pointError(
        screenCorners(renderedTarget(mount, record.id).matrix, record.src), expected[targetIndex],
      )));
      if (mount.querySelectorAll('[data-edit-rotation-ghost]').length !== 2
        || mount.querySelector('[data-edit-rotation-angle]').style.display !== 'none') {
        throw new Error(`zoom ${zoom} 多选旋转没有同步预览或错误显示单元素角度`);
      }
      view.element.dispatchEvent(pointer('pointerup', end, 130 + index));
      geometryError = Math.max(geometryError, ...before.map(({ record }, targetIndex) => pointError(
        screenCorners(renderedTarget(mount, record.id).matrix, record.src), expected[targetIndex],
      )));
      if (session.editor.history.undoCount !== 1 || geometryError > 0.5) {
        throw new Error(`zoom ${zoom} 多选旋转幽灵角度/中心偏差 ${geometryError.toFixed(3)}px`);
      }
      session.editor.undo();
    }
    return geometryError;
  } finally {
    session.dispose();
    mount.remove();
  }
}

function measureRotationFrames(mount, view, pointerId) {
  const frameRect = mount.querySelector('[data-edit-selection-frame]').getBoundingClientRect();
  const selectionCenter = center(frameRect);
  const handle = mount.querySelector('[data-edit-rotation-handle]');
  const start = center(handle.getBoundingClientRect());
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
    if (!entry || pending.size !== 1) throw new Error(`旋转帧队列失控：${pending.size}`);
    pending.delete(entry[0]);
    const started = performance.now();
    entry[1](started);
    return performance.now() - started;
  };
  const samples = [];
  let end = rotatePoint(start, selectionCenter, 4);
  try {
    handle.dispatchEvent(pointer('pointerdown', start, pointerId));
    view.element.dispatchEvent(pointer('pointermove', end, pointerId));
    samples.push(flush());
    for (let index = 0; index < 80; index++) {
      end = rotatePoint(start, selectionCenter, 20 + index % 7);
      view.element.dispatchEvent(pointer('pointermove', end, pointerId));
      samples.push(flush());
    }
    view.element.dispatchEvent(pointer('pointercancel', end, pointerId));
  } finally {
    window.requestAnimationFrame = originalRequest;
    window.cancelAnimationFrame = originalCancel;
  }
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length * 0.95)];
}

async function performanceContract(openEditor, load) {
  const mount = contractMount();
  const session = await openEditor(await load('sample-editor-60.pptx'), { idPrefix: 'browser-rotate-perf-' });
  try {
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg' });
    const ids = session.editor.doc.slides[view.slideId].children;
    session.editor.select({ kind: 'elements', ids, enteredGroup: null });
    const sources = ids.map((id) => session.editor.effectiveElement(id));
    const p95 = measureRotationFrames(mount, view, 140);
    const stable = ids.every((id, index) => {
      const current = session.editor.effectiveElement(id);
      return current.x === sources[index].x && current.y === sources[index].y
        && current.rot === sources[index].rot;
    });
    if (ids.length !== 60 || !stable || session.editor.history.undoCount !== 0
      || mount.querySelector('[data-edit-rotation-ghost]')) {
      throw new Error('60 元素旋转取消恢复失败');
    }
    recordPerformanceBudget('60 元素旋转帧 p95', p95, 8);
    return p95;
  } finally {
    session.dispose();
    mount.remove();
  }
}

export async function runEditorRotationBrowserContract({ openEditor, load }) {
  return {
    nestedError: await nestedGeometryContract(openEditor, load),
    multiError: await multiGeometryContract(openEditor, load),
    p95: await performanceContract(openEditor, load),
  };
}
