import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const center = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
const distance = (left, right) => Math.hypot(left.x - right.x, left.y - right.y);
const pointer = (type, point, pointerId) => new PointerEvent(type, {
  bubbles: true, composed: true, cancelable: true, pointerType: 'mouse', pointerId, isPrimary: true,
  button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: point.x, clientY: point.y,
});
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

function contractMount() {
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  return mount;
}

function handle(mount, pointId) {
  const value = mount.querySelector(`[data-ppt-vertex-point="${pointId}"]`);
  if (!value) throw new Error(`找不到顶点手柄：${pointId}`);
  return value;
}

function measureFrames(mount, view, pointId) {
  const start = center(handle(mount, pointId).getBoundingClientRect());
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
    if (!entry || pending.size !== 1) throw new Error(`顶点帧队列失控：${pending.size}`);
    pending.delete(entry[0]);
    const started = performance.now();
    entry[1](started);
    return performance.now() - started;
  };
  const samples = [];
  let end = { x: start.x + 4, y: start.y + 4 };
  try {
    handle(mount, pointId).dispatchEvent(pointer('pointerdown', start, 731));
    view.element.dispatchEvent(pointer('pointermove', end, 731));
    samples.push(flush());
    for (let index = 0; index < 80; index++) {
      end = { x: start.x + 24 + index % 5, y: start.y + 18 + index % 3 };
      view.element.dispatchEvent(pointer('pointermove', end, 731));
      samples.push(flush());
    }
    view.element.dispatchEvent(pointer('pointerup', end, 731));
  } finally {
    window.requestAnimationFrame = originalRequest;
    window.cancelAnimationFrame = originalCancel;
  }
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length * 0.95)];
}

export async function runEditorVertexBrowserContract({ openEditor, createVertexEditor, load }) {
  const mount = contractMount();
  const session = await openEditor(await load('sample-editor-vertex.pptx'), { idPrefix: 'browser-vertex-' });
  try {
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg' });
    const record = Object.values(session.editor.doc.elements)
      .find((candidate) => candidate.src.name === 'vertex-freeform');
    if (!record || Object.keys(session.editor.doc.elements).length !== 60) {
      throw new Error('顶点编辑固件缺少 60 元素负载或自由形状');
    }
    session.editor.select({ kind: 'elements', ids: [record.id], enteredGroup: null });
    const extension = createVertexEditor(session, view);
    if (!extension.start(record.id)) throw new Error('顶点扩展无法进入自由形状');
    const geometry = extension.geometry;
    const point = geometry.paths[0].commands[1].points[2];
    const originalPoint = { x: point.x.value, y: point.y.value };
    const targetNode = mount.querySelector(`[data-edit-id="${record.id}"]`);
    const staticSvg = mount.querySelector('[data-ppt-layer="static"] svg');
    const interaction = mount.querySelector('[data-ppt-layer="interaction"]');
    const start = center(handle(mount, point.id).getBoundingClientRect());
    const end = { x: start.x + 42, y: start.y + 27 };
    let captureCalls = 0;
    const originalCapture = view.element.setPointerCapture.bind(view.element);
    view.element.setPointerCapture = (pointerId) => {
      captureCalls++;
      try { originalCapture(pointerId); } catch { /* 合成事件只验证 capture 路径被调用。 */ }
    };
    handle(mount, point.id).dispatchEvent(pointer('pointerdown', start, 730));
    view.element.dispatchEvent(pointer('pointermove', end, 730));
    await nextFrame();
    const preview = center(handle(mount, point.id).getBoundingClientRect());
    const sourceDuring = extension.geometry.paths[0].commands[1].points[2];
    if (distance(preview, end) > 0.5 || sourceDuring.x.value !== originalPoint.x
      || sourceDuring.y.value !== originalPoint.y || captureCalls !== 1
      || mount.querySelector(`[data-edit-id="${record.id}"]`) !== targetNode
      || mount.querySelector('[data-ppt-layer="static"] svg') !== staticSvg
      || !interaction.querySelector('[data-ppt-vertex-editor]')) {
      throw new Error('顶点拖动帧重建静态层、提前写模型或未跟随指针');
    }
    view.element.dispatchEvent(pointer('pointerup', end, 730));
    const committed = extension.geometry.paths[0].commands[1].points[2];
    if (committed.x.value === originalPoint.x || committed.y.value === originalPoint.y
      || session.editor.history.undoCount !== 1 || view.element.dataset.pptVertexDragging !== undefined) {
      throw new Error('顶点拖动没有形成单一历史提交或清理手势状态');
    }
    session.editor.undo();
    const p95 = measureFrames(mount, view, point.id);
    if (session.editor.history.undoCount !== 1
      || mount.querySelector('[data-ppt-vertex-editor]')?.parentElement !== interaction) {
      throw new Error('60 元素顶点性能手势没有提交到交互层');
    }
    recordPerformanceBudget('60 元素顶点拖动帧 p95', p95, 8);
    extension.destroy();
    return { p95, geometryError: distance(preview, end), captureCalls };
  } finally {
    session.dispose();
    mount.remove();
  }
}
