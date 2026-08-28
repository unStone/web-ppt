import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const percentile95 = (samples) => [...samples].sort((left, right) => left - right)
  [Math.floor(samples.length * 0.95)];

const hasPageNumber = (root, value) => [...root.querySelectorAll('text')]
  .some((node) => node.textContent?.trim() === String(value));

/** 真实浏览器验证多 view/edit fallback、稳定 DOM 与 200 页连续删除预算。 */
export async function runEditorRemoveSlideBrowserContract({ openEditor, load }) {
  const editMount = document.createElement('div');
  const viewMount = document.createElement('div');
  const stableMount = document.createElement('div');
  for (const mount of [editMount, viewMount, stableMount]) mount.className = 'contract-offscreen';
  document.body.append(editMount, viewMount, stableMount);
  const session = await openEditor(await load('sample-editor-remove-slide.pptx'), {
    idPrefix: 'browser-remove-slide-',
  });
  try {
    const source = [...session.editor.doc.slideOrder];
    const editView = session.mount(editMount, { slideId: source[1], mode: 'edit', textMode: 'svg' });
    const viewView = session.mount(viewMount, { slideId: source[1], mode: 'view', textMode: 'svg' });
    const stableView = session.mount(stableMount, { slideId: source[2], mode: 'view', textMode: 'svg' });
    const stableStatic = stableMount.querySelector('[data-ppt-layer="static"]');
    const stableSvg = stableStatic.querySelector('svg');
    const textId = session.editor.doc.slides[source[1]].children[0];
    editMount.querySelector(`[data-edit-id="${textId}"]`).dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, composed: true }),
    );
    let observed = null;
    const unsubscribe = session.editor.subscribe((change) => { observed = change; });
    const result = session.editor.exec({ type: 'RemoveSlide', id: source[1] });
    if (editView.slideId !== source[2] || viewView.slideId !== source[2]
      || stableView.slideId !== source[2]
      || !editMount.textContent.includes('可删除页面 3')
      || !viewMount.textContent.includes('可删除页面 3')
      || editMount.querySelector('[data-ppt-text-editor]')
      || stableStatic.querySelector('svg') !== stableSvg || !hasPageNumber(stableStatic, 2)
      || result.removedSlideFallbacks.get(source[1]) !== source[2]
      || observed?.removedSlideFallbacks.get(source[1]) !== source[2]
      || !observed?.removedSlides.has(source[1])
      || observed.createdSlides.size || observed.movedSlides.size) {
      throw new Error('RemoveSlide 没有保持多视图 fallback、稳定 DOM 或框架订阅语义');
    }
    unsubscribe();
  } finally {
    session.dispose();
    editMount.remove();
    viewMount.remove();
    stableMount.remove();
  }

  const performanceSession = await openEditor(await load('sample-editor-add-slide.pptx'), {
    idPrefix: 'browser-remove-slide-perf-', historyLimit: 400,
  });
  try {
    const layoutId = performanceSession.editor.doc.layoutOrder.find((id) =>
      performanceSession.editor.doc.layouts[id].name === '标题和正文');
    let after = performanceSession.editor.doc.slideOrder[0];
    while (performanceSession.editor.doc.slideOrder.length < 200) {
      const result = performanceSession.editor.exec({ type: 'AddSlide', layoutId, at: { after } });
      after = [...result.createdSlides][0];
    }
    performanceSession.editor.history.clear();
    const samples = [];
    while (performanceSession.editor.doc.slideOrder.length > 1) {
      const id = performanceSession.editor.doc.slideOrder[0];
      const started = performance.now();
      const result = performanceSession.editor.exec({ type: 'RemoveSlide', id });
      samples.push(performance.now() - started);
      if (!result.removedSlideFallbacks.has(id)) throw new Error('连续删除缺少 fallback');
    }
    const p95 = percentile95(samples);
    if (samples.length !== 199 || performanceSession.editor.doc.slideOrder.length !== 1) {
      throw new Error('200→1 页连续删除的操作数或最终页数不一致');
    }
    recordPerformanceBudget('200→1 页连续删除 p95', p95, 16);
    return { p95, pageCount: 200 };
  } finally {
    performanceSession.dispose();
  }
}
