import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const p95 = (samples) => [...samples].sort((left, right) => left - right)
  [Math.floor(samples.length * 0.95)];

/** 真实浏览器验证多视图稳定身份与 200 页页序提交预算。 */
export async function runEditorMoveSlideBrowserContract({ openEditor, load }) {
  const editMount = document.createElement('div');
  const viewMount = document.createElement('div');
  editMount.className = 'contract-offscreen';
  viewMount.className = 'contract-offscreen';
  document.body.append(editMount, viewMount);
  const session = await openEditor(await load('sample-editor-move-slide.pptx'), {
    idPrefix: 'browser-move-slide-',
  });
  try {
    const [first, second, third] = session.editor.doc.slideOrder;
    const editView = session.mount(editMount, { slideId: second, mode: 'edit', textMode: 'svg' });
    const viewView = session.mount(viewMount, { slideId: third, mode: 'view', textMode: 'svg' });
    const editStatic = editMount.querySelector('[data-ppt-layer="static"]');
    const viewStatic = viewMount.querySelector('[data-ppt-layer="static"]');
    const editSvg = editStatic.querySelector('svg');
    const viewSvg = viewStatic.querySelector('svg');
    let observed = null;
    const unsubscribe = session.editor.subscribe((change) => { observed = change; });
    session.editor.exec({ type: 'MoveSlide', id: second, at: { after: null } });
    if (editView.slideId !== second || viewView.slideId !== third
      || !editStatic.textContent.includes('1') || !viewStatic.textContent.includes('3')
      || editStatic.querySelector('svg') !== editSvg || viewStatic.querySelector('svg') !== viewSvg
      || !observed?.movedSlides.has(second)
      || observed.createdSlides.size || observed.removedSlides.size
      || session.editor.doc.slideOrder.join(',') !== [second, first, third].join(',')) {
      throw new Error('MoveSlide 没有保持多视图身份、增量 DOM 或框架订阅语义');
    }
    unsubscribe();
  } finally {
    session.dispose();
    editMount.remove();
    viewMount.remove();
  }

  const performanceSession = await openEditor(await load('sample-editor-add-slide.pptx'), {
    idPrefix: 'browser-move-slide-perf-', historyLimit: 400,
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
    for (let index = 0; index < 80; index++) {
      const order = performanceSession.editor.doc.slideOrder;
      const id = index % 2 ? order[0] : order.at(-1);
      const target = index % 2 ? order.at(-1) : null;
      const started = performance.now();
      performanceSession.editor.exec({ type: 'MoveSlide', id, at: { after: target } });
      samples.push(performance.now() - started);
    }
    const feedbackP95 = p95(samples);
    if (performanceSession.editor.doc.slideOrder.length !== 200) throw new Error('200 页重排后页数不一致');
    recordPerformanceBudget('200 页重排 p95', feedbackP95, 16);
    return { p95: feedbackP95, pageCount: performanceSession.editor.doc.slideOrder.length };
  } finally {
    performanceSession.dispose();
  }
}
