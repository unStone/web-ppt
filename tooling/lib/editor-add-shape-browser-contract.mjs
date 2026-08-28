import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const p95 = (samples) => {
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length * 0.95)];
};
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const center = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
const pointer = (type, point, pointerId) => new PointerEvent(type, {
  bubbles: true, composed: true, cancelable: true, pointerType: 'mouse', pointerId, isPrimary: true,
  button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: point.x, clientY: point.y,
});

/** 真实 SVG 布局校验新增几何，并把完整模型→DOM→选择框反馈守在一帧预算内。 */
export async function runEditorAddShapeBrowserContract({ openEditor, load }) {
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  const geometrySession = await openEditor(await load('sample-editor-add-shape.pptx'), {
    idPrefix: 'browser-add-shape-geometry-',
  });
  let geometryError = Infinity;
  try {
    const view = geometrySession.mount(mount, { mode: 'edit', textMode: 'svg', zoom: 0.75, snapping: false });
    geometrySession.editor.exec({
      type: 'AddShape', slideId: view.slideId, preset: 'roundRect',
      rect: { x: 360, y: 180, w: 280, h: 160 },
    });
    const id = geometrySession.editor.selection.kind === 'elements'
      ? geometrySession.editor.selection.ids[0] : null;
    let partition = mount.querySelector(`[data-edit-id="${id}"]`);
    const frame = mount.querySelector('[data-edit-selection-frame]');
    const stage = mount.querySelector('[data-ppt-stage]');
    const stageRect = stage.getBoundingClientRect();
    const frameRect = frame?.getBoundingClientRect();
    geometryError = frameRect ? Math.max(
      Math.abs(frameRect.left - stageRect.left - 360 * 0.75),
      Math.abs(frameRect.top - stageRect.top - 180 * 0.75),
      Math.abs(frameRect.width - 280 * 0.75),
      Math.abs(frameRect.height - 160 * 0.75),
    ) : Infinity;
    const dragStart = center(partition.getBoundingClientRect());
    const dragEnd = { x: dragStart.x + 24, y: dragStart.y + 18 };
    partition.dispatchEvent(pointer('pointerdown', dragStart, 601));
    view.element.dispatchEvent(pointer('pointermove', dragEnd, 601));
    await nextFrame();
    if (!mount.querySelector('[data-edit-drag-ghost]')
      || geometrySession.editor.effectiveElement(id).x !== 360) {
      throw new Error('新增形状未进入拖拽预览或预览期提前写入模型');
    }
    view.element.dispatchEvent(pointer('pointerup', dragEnd, 601));
    const moved = geometrySession.editor.effectiveElement(id);
    if (Math.abs(moved.x - 392) > 1e-6 || Math.abs(moved.y - 204) > 1e-6) {
      throw new Error(`新增形状拖拽提交偏差：${moved.x},${moved.y}`);
    }

    const resizeHandle = mount.querySelector('[data-edit-resize-handle="se"]');
    const resizeStart = center(resizeHandle.getBoundingClientRect());
    const resizeEnd = { x: resizeStart.x + 30, y: resizeStart.y + 15 };
    resizeHandle.dispatchEvent(pointer('pointerdown', resizeStart, 602));
    view.element.dispatchEvent(pointer('pointermove', resizeEnd, 602));
    await nextFrame();
    if (!mount.querySelector('[data-edit-resize-ghost]')
      || geometrySession.editor.effectiveElement(id).w !== 280) {
      throw new Error('新增形状未进入缩放预览或预览期提前写入模型');
    }
    view.element.dispatchEvent(pointer('pointerup', resizeEnd, 602));
    const resized = geometrySession.editor.effectiveElement(id);
    if (Math.abs(resized.w - 320) > 1e-6 || Math.abs(resized.h - 180) > 1e-6) {
      throw new Error(`新增形状缩放提交偏差：${resized.w},${resized.h}`);
    }

    partition = mount.querySelector(`[data-edit-id="${id}"]`);
    partition?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
    if (!partition || !frame || geometryError > 0.5
      || !mount.querySelector(`[data-ppt-text-editor="${id}"]`)) {
      throw new Error(`新增形状几何/选择/文字入口失效：error=${geometryError.toFixed(3)}`);
    }
  } finally {
    geometrySession.dispose();
    mount.replaceChildren();
  }

  const performanceSession = await openEditor(await load('sample-editor-60.pptx'), {
    idPrefix: 'browser-add-shape-perf-',
  });
  try {
    const view = performanceSession.mount(mount, { mode: 'edit', textMode: 'svg', snapping: false });
    const slideId = view.slideId;
    const siblingId = performanceSession.editor.doc.slides[slideId].children[0];
    const staticLayer = mount.querySelector('[data-ppt-layer="static"]');
    const svg = staticLayer.querySelector('svg');
    const sibling = staticLayer.querySelector(`[data-edit-id="${siblingId}"]`);
    const samples = [];
    for (let index = 0; index < 80; index++) {
      const started = performance.now();
      performanceSession.editor.exec({
        type: 'AddShape', slideId, preset: index % 2 ? 'ellipse' : 'rect',
        rect: { x: 700 + index % 5, y: 500, w: 90, h: 60 },
      });
      const id = performanceSession.editor.selection.kind === 'elements'
        ? performanceSession.editor.selection.ids[0] : null;
      mount.querySelector(`[data-edit-selection-id="${id}"]`)?.getBoundingClientRect();
      samples.push(performance.now() - started);
      performanceSession.editor.undo();
      staticLayer.querySelector('svg')?.getBoundingClientRect();
    }
    const addP95 = p95(samples);
    if (performanceSession.editor.doc.slides[slideId].children.length !== 60
      || staticLayer.querySelector('svg') !== svg
      || staticLayer.querySelector(`[data-edit-id="${siblingId}"]`) !== sibling
      || performanceSession.editor.isDirty() || performanceSession.editor.history.undoCount !== 0) {
      throw new Error('60 元素页新增形状后的 DOM 或历史不稳定');
    }
    recordPerformanceBudget('60 元素页新增形状完整反馈 p95', addP95, 16);
    return { geometryError, p95: addP95 };
  } finally {
    performanceSession.dispose();
    mount.remove();
  }
}
