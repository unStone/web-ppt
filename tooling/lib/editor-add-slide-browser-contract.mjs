import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const p95 = (samples) => {
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length * 0.95)];
};

const textOf = (element) => element.text?.paragraphs
  .map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n') ?? '';

/** 真实浏览器验证 20 页连续新增的完整反馈、占位符几何和 edit/view 隔离。 */
export async function runEditorAddSlideBrowserContract({ openEditor, load }) {
  const editMount = document.createElement('div');
  const viewMount = document.createElement('div');
  editMount.className = 'contract-offscreen';
  viewMount.className = 'contract-offscreen';
  document.body.append(editMount, viewMount);
  const session = await openEditor(await load('sample-editor-add-slide.pptx'), {
    idPrefix: 'browser-add-slide-',
  });
  try {
    const editView = session.mount(editMount, { mode: 'edit', textMode: 'svg', zoom: 0.75, snapping: false });
    const viewView = session.mount(viewMount, { mode: 'view', textMode: 'svg', zoom: 0.75, snapping: false });
    const layoutId = session.editor.doc.layoutOrder.find((id) =>
      session.editor.doc.layouts[id].name === '标题和正文');
    let after = session.editor.doc.slideOrder[0];
    let geometryError = Infinity;
    const samples = [];
    for (let index = 0; index < 20; index++) {
      const started = performance.now();
      const result = session.editor.exec({ type: 'AddSlide', layoutId, at: { after } });
      const slideId = [...result.createdSlides][0];
      editView.setSlide(slideId);
      viewView.setSlide(slideId);
      const title = session.editor.doc.slides[slideId].children.map((id) => session.editor.doc.elements[id])
        .find((record) => record.meta.ph?.type === 'title');
      const hit = editMount.querySelector(`[data-edit-placeholder-id="${title.id}"]`);
      const stage = editMount.querySelector('[data-ppt-stage]');
      const hitRect = hit?.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      if (index === 0 && hitRect) geometryError = Math.max(
        Math.abs(hitRect.left - stageRect.left - 80 * 0.75),
        Math.abs(hitRect.top - stageRect.top - 80 * 0.75),
        Math.abs(hitRect.width - 1120 * 0.75),
        Math.abs(hitRect.height - 100 * 0.75),
      );
      if (!hit || viewMount.querySelector('[data-edit-placeholder-id]')
        || !editMount.querySelector('[data-edit-id]') || !viewMount.querySelector('[data-edit-id]')) {
        throw new Error(`第 ${index + 1} 次新增页没有完成 edit/view 反馈`);
      }
      hit.getBoundingClientRect();
      samples.push(performance.now() - started);
      after = slideId;
    }
    const feedbackP95 = p95(samples);
    const lastSlide = after;
    const title = session.editor.doc.slides[lastSlide].children.map((id) => session.editor.doc.elements[id])
      .find((record) => record.meta.ph?.type === 'title');
    const hit = editMount.querySelector(`[data-edit-placeholder-id="${title.id}"]`);
    hit.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
    const editable = editMount.querySelector(`[data-ppt-text-editor="${title.id}"]`);
    if (geometryError > 0.5 || session.editor.doc.slideOrder.length !== 21
      || !editable
      || session.editor.selection.kind !== 'text' || session.editor.selection.id !== title.id) {
      throw new Error(`新增页几何或文字失败：error=${geometryError.toFixed(3)}`);
    }
    recordPerformanceBudget('新增页完整反馈 p95', feedbackP95, 16);
    const input = new InputEvent('beforeinput', {
      bubbles: true, composed: true, cancelable: true, inputType: 'insertText', data: '真实浏览器标题',
    });
    const accepted = editable.dispatchEvent(input);
    const rendered = editMount.querySelector(`[data-ppt-text-editor="${title.id}"]`);
    if (accepted || textOf(session.editor.effectiveElement(title.id)) !== '真实浏览器标题'
      || !rendered?.textContent.includes('真实浏览器标题')) {
      throw new Error('新增页占位符没有把真实 Chrome 输入提交到模型并上屏');
    }
    editView.setMode('view');
    if (editMount.querySelector('[data-edit-placeholder-id]')) throw new Error('edit→view 后仍残留占位符辅助节点');
    editView.setMode('edit');
    if (!editMount.querySelector('[data-edit-placeholder-id]')) throw new Error('view→edit 后未恢复空占位符辅助节点');
    return { geometryError, p95: feedbackP95, pageCount: session.editor.doc.slideOrder.length };
  } finally {
    session.dispose();
    editMount.remove();
    viewMount.remove();
  }
}
