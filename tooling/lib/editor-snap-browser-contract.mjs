/** Chrome 的 getScreenCTM 是吸附幽灵与参考线的独立 oracle。 */
import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const near = (actual, expected, epsilon = 1e-6) => Math.abs(actual - expected) <= epsilon;
const center = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
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

function byName(session, name) {
  const record = Object.values(session.editor.doc.elements)
    .find((candidate) => candidate.src.name === name);
  if (!record) throw new Error(`吸附固件缺少 ${name}`);
  return record;
}

function slidePoint(mount, x, y) {
  const svg = mount.querySelector('svg[data-ppt-layer="interaction"]');
  const matrix = svg?.getScreenCTM();
  if (!matrix) throw new Error('无法取得吸附交互层屏幕矩阵');
  return new DOMPoint(x, y).matrixTransform(matrix);
}

function guidePoint(line, xAttribute, yAttribute) {
  const matrix = line?.getScreenCTM();
  if (!matrix) throw new Error('无法取得吸附参考线屏幕矩阵');
  return new DOMPoint(
    Number(line.getAttribute(xAttribute)), Number(line.getAttribute(yAttribute)),
  ).matrixTransform(matrix);
}

async function thresholdContract(openEditor, load) {
  const mount = contractMount();
  const session = await openEditor(await load('sample-editor-snap.pptx'), {
    idPrefix: 'browser-snap-threshold-',
  });
  try {
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg' });
    const target = byName(session, 'snap-threshold-target');
    let error = 0;
    for (const [index, zoom] of [0.5, 1, 2].entries()) {
      view.setZoom(zoom);
      session.editor.select({ kind: 'elements', ids: [target.id], enteredGroup: null });
      let node = mount.querySelector(`[data-edit-id="${target.id}"]`);
      let before = node.getBoundingClientRect();
      let start = center(before);
      const outsideEnd = { x: start.x + 100 * zoom - 6.5, y: start.y };
      node.dispatchEvent(pointer('pointerdown', start, 150 + index * 2));
      view.element.dispatchEvent(pointer('pointermove', outsideEnd, 150 + index * 2));
      await nextFrame();
      const outside = node.getBoundingClientRect();
      error = Math.max(error, Math.abs(outside.left - before.left - (outsideEnd.x - start.x)));
      if (mount.querySelector('[data-edit-snap-guide="x"]')) {
        throw new Error(`zoom ${zoom} 超出 6px 仍发生横向吸附`);
      }
      view.element.dispatchEvent(pointer('pointercancel', outsideEnd, 150 + index * 2));
      if (!near(session.editor.effectiveElement(target.id).x, 100)
        || mount.querySelector('[data-edit-drag-ghost]')
        || mount.querySelector('[data-edit-snap-guides]')) {
        throw new Error(`zoom ${zoom} 阈值外取消未恢复`);
      }

      node = mount.querySelector(`[data-edit-id="${target.id}"]`);
      before = node.getBoundingClientRect();
      start = center(before);
      const boundaryEnd = { x: start.x + 100 * zoom - 6, y: start.y };
      const staticSvg = mount.querySelector('[data-ppt-layer="static"] svg');
      const defs = staticSvg.querySelector('defs');
      node.dispatchEvent(pointer('pointerdown', start, 151 + index * 2));
      view.element.dispatchEvent(pointer('pointermove', boundaryEnd, 151 + index * 2));
      await nextFrame();
      const during = node.getBoundingClientRect();
      const guide = mount.querySelector('[data-edit-snap-guide="x"]');
      const actualGuide = guidePoint(guide, 'x1', 'y1');
      const expectedGuide = slidePoint(mount, 300, Number(guide.getAttribute('y1')));
      error = Math.max(
        error,
        Math.abs(during.left - before.left - 100 * zoom),
        Math.hypot(actualGuide.x - expectedGuide.x, actualGuide.y - expectedGuide.y),
      );
      if (mount.querySelector(`[data-edit-id="${target.id}"]`) !== node
        || mount.querySelector('[data-ppt-layer="static"] svg') !== staticSvg
        || staticSvg.querySelector('defs') !== defs
        || !near(session.editor.effectiveElement(target.id).x, 100)) {
        throw new Error(`zoom ${zoom} 吸附预览重建静态 DOM 或提前写模型`);
      }
      view.element.dispatchEvent(pointer('pointerup', boundaryEnd, 151 + index * 2));
      if (!near(session.editor.effectiveElement(target.id).x, 200)
        || session.editor.history.undoCount !== 1
        || mount.querySelector('[data-edit-drag-ghost]')
        || mount.querySelector('[data-edit-snap-guides]')) {
        throw new Error(`zoom ${zoom} 吸附没有单事务提交`);
      }
      session.editor.undo();
    }
    if (error > 0.5) throw new Error(`三档缩放吸附屏幕偏差 ${error.toFixed(3)}px`);
    return error;
  } finally {
    session.dispose();
    mount.remove();
  }
}

async function groupContract(openEditor, load) {
  const mount = contractMount();
  const session = await openEditor(await load('sample-editor-snap.pptx'), {
    idPrefix: 'browser-snap-group-',
  });
  try {
    const view = session.mount(mount, {
      mode: 'edit', textMode: 'svg', slideId: session.editor.doc.slideOrder[5],
    });
    const target = byName(session, 'snap-group-target');
    const group = byName(session, 'snap-group');
    session.editor.select({ kind: 'elements', ids: [target.id], enteredGroup: group.id });
    const node = mount.querySelector(`[data-edit-id="${target.id}"]`);
    const before = node.getBoundingClientRect();
    const start = center(before);
    const end = { x: start.x + 114, y: start.y };
    node.dispatchEvent(pointer('pointerdown', start, 170));
    view.element.dispatchEvent(pointer('pointermove', end, 170));
    await nextFrame();
    const during = node.getBoundingClientRect();
    const guide = mount.querySelector('[data-edit-snap-guide="x"]');
    const actualGuide = guidePoint(guide, 'x1', 'y1');
    const expectedGuide = slidePoint(mount, 340, Number(guide.getAttribute('y1')));
    let error = Math.max(
      Math.abs(during.left - before.left - 120),
      Math.hypot(actualGuide.x - expectedGuide.x, actualGuide.y - expectedGuide.y),
    );
    view.element.dispatchEvent(pointer('pointerup', end, 170));
    const committed = session.editor.effectiveElement(target.id);
    if (!near(committed.x, 80) || !near(committed.y, 20)
      || session.editor.history.undoCount !== 1 || mount.querySelector('[data-edit-snap-guides]')) {
      throw new Error('缩放组吸附未反解为父空间单事务');
    }
    session.editor.undo();
    if (error > 0.5) throw new Error(`缩放组吸附屏幕偏差 ${error.toFixed(3)}px`);
    return error;
  } finally {
    session.dispose();
    mount.remove();
  }
}

function spacingEndpointError(mount, group, axis, expected) {
  const lines = [...group.querySelectorAll('[data-edit-spacing-segment]')];
  if (lines.length !== 2 || group.querySelectorAll('[data-edit-spacing-arrow]').length !== 4) {
    throw new Error(`${axis} 等距参考线缺少两段线或四个箭头`);
  }
  return Math.max(...lines.flatMap((line, index) => ['1', '2'].map((suffix) => {
    const actual = guidePoint(line, `x${suffix}`, `y${suffix}`);
    const value = expected[index][Number(suffix) - 1];
    const other = Number(line.getAttribute(axis === 'x' ? 'y1' : 'x1'));
    const wanted = axis === 'x' ? slidePoint(mount, value, other) : slidePoint(mount, other, value);
    return Math.hypot(actual.x - wanted.x, actual.y - wanted.y);
  })));
}

async function spacingContract(openEditor, load) {
  const mount = contractMount();
  const session = await openEditor(await load('sample-editor-snap.pptx'), {
    idPrefix: 'browser-snap-spacing-',
  });
  try {
    const view = session.mount(mount, {
      mode: 'edit', textMode: 'svg', slideId: session.editor.doc.slideOrder[4],
    });
    const gestures = [
      { name: 'snap-spacing-target', axis: 'x', raw: 594, expected: [[330, 450], [530, 650]], value: 650 },
      { name: 'snap-spacing-vertical-target', axis: 'y', raw: -234, expected: [[130, 210], [290, 370]], value: 210 },
    ];
    let error = 0;
    for (const [index, gesture] of gestures.entries()) {
      const target = byName(session, gesture.name);
      session.editor.select({ kind: 'elements', ids: [target.id], enteredGroup: null });
      const node = mount.querySelector(`[data-edit-id="${target.id}"]`);
      const before = node.getBoundingClientRect();
      const start = center(before);
      const end = {
        x: start.x + (gesture.axis === 'x' ? gesture.raw : 0),
        y: start.y + (gesture.axis === 'y' ? gesture.raw : 0),
      };
      node.dispatchEvent(pointer('pointerdown', start, 180 + index));
      view.element.dispatchEvent(pointer('pointermove', end, 180 + index));
      await nextFrame();
      const group = mount.querySelector(`[data-edit-spacing-guide="${gesture.axis}"]`);
      error = Math.max(error, spacingEndpointError(mount, group, gesture.axis, gesture.expected));
      view.element.dispatchEvent(pointer('pointerup', end, 180 + index));
      const committed = session.editor.effectiveElement(target.id);
      if (!near(committed[gesture.axis], gesture.value)
        || session.editor.history.undoCount !== 1 || mount.querySelector('[data-edit-snap-guides]')) {
        throw new Error(`${gesture.axis} 等距吸附没有单事务提交`);
      }
      session.editor.undo();
    }
    if (error > 0.5) throw new Error(`等距参考线屏幕偏差 ${error.toFixed(3)}px`);
    return error;
  } finally {
    session.dispose();
    mount.remove();
  }
}

function flushFrame(pending, mount) {
  const next = pending.entries().next().value;
  if (!next || pending.size !== 1) throw new Error(`吸附帧队列失控：${pending.size}`);
  pending.delete(next[0]);
  const started = performance.now();
  next[1](started);
  for (const node of mount.querySelectorAll(
    '[data-edit-drag-ghost], [data-edit-snap-guide], [data-edit-spacing-guide]',
  )) node.getBoundingClientRect();
  return performance.now() - started;
}

async function performanceContract(openEditor, load) {
  const mount = contractMount();
  const session = await openEditor(await load('sample-editor-60.pptx'), { idPrefix: 'browser-snap-perf-' });
  try {
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg' });
    const ids = session.editor.doc.slides[view.slideId].children;
    const id = ids[0];
    session.editor.select({ kind: 'elements', ids: [id], enteredGroup: null });
    const node = mount.querySelector(`[data-edit-id="${id}"]`);
    const source = session.editor.effectiveElement(id);
    const history = session.editor.history.undoCount;
    const staticSvg = mount.querySelector('[data-ppt-layer="static"] svg');
    const start = center(node.getBoundingClientRect());
    const pending = new Map();
    let serial = 0;
    const originalRequest = window.requestAnimationFrame;
    const originalCancel = window.cancelAnimationFrame;
    const samples = [];
    window.requestAnimationFrame = (callback) => {
      const frame = ++serial;
      pending.set(frame, callback);
      return frame;
    };
    window.cancelAnimationFrame = (frame) => pending.delete(frame);
    try {
      node.dispatchEvent(pointer('pointerdown', start, 190));
      for (let index = 0; index < 80; index++) {
        const end = { x: start.x + 30 + index % 2, y: start.y + 24 + index % 3 };
        view.element.dispatchEvent(pointer('pointermove', end, 190));
        samples.push(flushFrame(pending, mount));
      }
      view.element.dispatchEvent(pointer('pointercancel', start, 190));
    } finally {
      window.requestAnimationFrame = originalRequest;
      window.cancelAnimationFrame = originalCancel;
    }
    samples.sort((left, right) => left - right);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    if (ids.length !== 60
      || !near(session.editor.effectiveElement(id).x, source.x)
      || session.editor.history.undoCount !== history
      || mount.querySelector('[data-edit-drag-ghost]')
      || mount.querySelector('[data-edit-snap-guides]')
      || mount.querySelector('[data-ppt-layer="static"] svg') !== staticSvg) {
      throw new Error('60 元素吸附拖动取消恢复失败');
    }
    recordPerformanceBudget('60 元素吸附拖动帧 p95', p95, 8);
    return p95;
  } finally {
    session.dispose();
    mount.remove();
  }
}

export async function runEditorSnapBrowserContract({ openEditor, load }) {
  return {
    thresholdError: await thresholdContract(openEditor, load),
    groupError: await groupContract(openEditor, load),
    spacingError: await spacingContract(openEditor, load),
    p95: await performanceContract(openEditor, load),
  };
}
