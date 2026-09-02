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

function handle(mount, index = 0) {
  const value = mount.querySelector(`[data-ppt-preset-handle="${index}"]`);
  if (!value) throw new Error(`找不到预设调节柄：${index}`);
  return value;
}

function tangent(record, length) {
  const angle = (record.src.rot ?? 0) * Math.PI / 180;
  return { x: length * Math.cos(angle), y: length * Math.sin(angle) };
}

function measureFrames(mount, view, record) {
  const start = center(handle(mount).getBoundingClientRect());
  const direction = tangent(record, 1);
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
    if (!entry || pending.size !== 1) throw new Error(`预设调节柄帧队列失控：${pending.size}`);
    pending.delete(entry[0]);
    const started = performance.now();
    entry[1](started);
    return performance.now() - started;
  };
  const samples = [];
  let end = { x: start.x + direction.x * 4, y: start.y + direction.y * 4 };
  try {
    handle(mount).dispatchEvent(pointer('pointerdown', start, 743));
    view.element.dispatchEvent(pointer('pointermove', end, 743));
    samples.push(flush());
    for (let index = 0; index < 80; index++) {
      const offset = 12 + index % 14;
      end = { x: start.x + direction.x * offset, y: start.y + direction.y * offset };
      view.element.dispatchEvent(pointer('pointermove', end, 743));
      samples.push(flush());
    }
    view.element.dispatchEvent(pointer('pointerup', end, 743));
  } finally {
    window.requestAnimationFrame = originalRequest;
    window.cancelAnimationFrame = originalCancel;
  }
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length * 0.95)];
}

export async function runEditorPresetAdjustmentBrowserContract({
  openEditor, createPresetAdjustmentEditor, load,
}) {
  const mount = contractMount();
  const bytes = await load('sample-editor-preset-shape.pptx');
  const session = await openEditor(bytes, { idPrefix: 'browser-preset-adjustment-' });
  try {
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg' });
    const record = Object.values(session.editor.doc.elements)
      .find((candidate) => candidate.src.name === 'preset-source');
    if (!record || Object.keys(session.editor.doc.elements).length < 60) {
      throw new Error('预设调节柄固件缺少 60 元素负载或目标形状');
    }
    session.editor.select({ kind: 'elements', ids: [record.id], enteredGroup: null });
    const extension = createPresetAdjustmentEditor(session, view);
    if (!extension.start(record.id) || extension.handles.length !== 1) {
      throw new Error('预设调节柄扩展无法进入圆角矩形');
    }
    const sourceValue = extension.geometry.adj.adj;
    const targetNode = mount.querySelector(`[data-edit-id="${record.id}"]`);
    const staticSvg = mount.querySelector('[data-ppt-layer="static"] svg');
    const interaction = mount.querySelector('[data-ppt-layer="interaction"]');
    const start = center(handle(mount).getBoundingClientRect());
    const delta = tangent(record, 22);
    const end = { x: start.x + delta.x, y: start.y + delta.y };
    let captureCalls = 0;
    const originalCapture = view.element.setPointerCapture.bind(view.element);
    view.element.setPointerCapture = (pointerId) => {
      captureCalls++;
      try { originalCapture(pointerId); } catch { /* 合成事件只验证 capture 路径。 */ }
    };
    handle(mount).dispatchEvent(pointer('pointerdown', start, 742));
    view.element.dispatchEvent(pointer('pointermove', end, 742));
    await nextFrame();
    const preview = center(handle(mount).getBoundingClientRect());
    if (distance(preview, end) > 0.5 || extension.geometry.adj.adj !== sourceValue
      || captureCalls !== 1 || mount.querySelector(`[data-edit-id="${record.id}"]`) !== targetNode
      || mount.querySelector('[data-ppt-layer="static"] svg') !== staticSvg
      || !interaction.querySelector('[data-ppt-preset-adjustments]')) {
      throw new Error('预设调节柄拖动重建静态层、提前写模型或没有精确跟随指针');
    }
    view.element.dispatchEvent(pointer('pointerup', end, 742));
    const committed = extension.geometry.adj.adj;
    if (committed === sourceValue || session.editor.history.undoCount !== 1
      || view.element.dataset.pptPresetDragging !== undefined) {
      throw new Error('预设调节柄没有形成单一历史提交或清理手势状态');
    }
    const saved = await session.editor.save();
    const reopened = await openEditor(saved, { idPrefix: 'browser-preset-reopen-' });
    const reopenedRecord = Object.values(reopened.editor.doc.elements)
      .find((candidate) => candidate.src.name === 'preset-source');
    if (reopenedRecord.meta.geom?.adj.adj !== committed) {
      throw new Error('真实 Chrome 拖动保存重开后调节值不一致');
    }
    reopened.dispose();
    session.editor.undo();
    const p95 = measureFrames(mount, view, record);
    if (session.editor.history.undoCount !== 1
      || mount.querySelector('[data-ppt-preset-adjustments]')?.parentElement !== interaction) {
      throw new Error('60 元素预设调节柄性能手势没有提交到交互层');
    }
    recordPerformanceBudget('60 元素预设调节柄拖动帧 p95', p95, 8);
    extension.destroy();
    return { p95, geometryError: distance(preview, end), captureCalls };
  } finally {
    session.dispose();
    mount.remove();
  }
}
