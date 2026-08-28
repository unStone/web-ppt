import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const percentile95 = (samples) => [...samples].sort((left, right) => left - right)
  [Math.floor(samples.length * 0.95)];

const pageNumber = (root) => [...root.querySelectorAll('text')]
  .map((node) => node.textContent?.trim()).find((text) => /^\d+$/.test(text ?? ''));

/** 真实浏览器验证独立副本挂载，以及 200 页/60 元素复制与撤销完整反馈预算。 */
export async function runEditorDuplicateSlideBrowserContract({ openEditor, load }) {
  const sourceMount = document.createElement('div');
  const successorMount = document.createElement('div');
  const duplicateMount = document.createElement('div');
  for (const mount of [sourceMount, successorMount, duplicateMount]) {
    mount.className = 'contract-offscreen';
  }
  document.body.append(sourceMount, successorMount, duplicateMount);
  const session = await openEditor(await load('sample-editor-duplicate-slide.pptx'), {
    idPrefix: 'browser-duplicate-slide-',
  });
  try {
    const source = [...session.editor.doc.slideOrder];
    const sourceView = session.mount(sourceMount, {
      slideId: source[1], mode: 'edit', textMode: 'svg',
    });
    const successorView = session.mount(successorMount, {
      slideId: source[2], mode: 'view', textMode: 'svg',
    });
    const sourceStatic = sourceMount.querySelector('[data-ppt-layer="static"]');
    const successorStatic = successorMount.querySelector('[data-ppt-layer="static"]');
    const sourceSvg = sourceStatic.querySelector('svg');
    const successorSvg = successorStatic.querySelector('svg');
    let observed = null;
    const unsubscribe = session.editor.subscribe((change) => { observed = change; });
    const result = session.editor.exec({ type: 'DuplicateSlide', id: source[1] });
    const duplicateId = [...result.createdSlides][0];
    const duplicateView = session.mount(duplicateMount, {
      slideId: duplicateId, mode: 'edit', textMode: 'svg',
    });
    if (sourceView.slideId !== source[1] || successorView.slideId !== source[2]
      || sourceStatic.querySelector('svg') !== sourceSvg
      || successorStatic.querySelector('svg') !== successorSvg
      || pageNumber(successorStatic) !== '4'
      || duplicateView.slideId !== duplicateId
      || !duplicateMount.textContent.includes('可删除页面 2')
      || pageNumber(duplicateMount) !== '3'
      || !observed?.createdSlides.has(duplicateId)
      || observed.removedSlides.size || observed.movedSlides.size) {
      throw new Error('DuplicateSlide 没有保持多视图身份、动态字段或框架订阅语义');
    }
    unsubscribe();
  } finally {
    session.dispose();
    sourceMount.remove();
    successorMount.remove();
    duplicateMount.remove();
  }

  const perfMount = document.createElement('div');
  perfMount.className = 'contract-offscreen';
  document.body.append(perfMount);
  const performanceSession = await openEditor(await load('sample-editor-add-slide.pptx'), {
    idPrefix: 'browser-duplicate-slide-perf-', historyLimit: 500,
  });
  try {
    const editor = performanceSession.editor;
    const sourceId = editor.doc.slideOrder[0];
    for (let index = 0; index < 59; index++) {
      editor.exec({
        type: 'AddShape', slideId: sourceId, preset: 'rect',
        rect: { x: 20 + (index % 10) * 80, y: 20 + Math.floor(index / 10) * 70, w: 60, h: 40 },
      });
    }
    const layoutId = editor.doc.layoutOrder.find((id) =>
      editor.doc.layouts[id].name === '标题和正文');
    let after = sourceId;
    while (editor.doc.slideOrder.length < 200) {
      const created = editor.exec({ type: 'AddSlide', layoutId, at: { after } });
      after = [...created.createdSlides][0];
    }
    const tailId = editor.doc.slideOrder.at(-1);
    const tailView = performanceSession.mount(perfMount, {
      slideId: tailId, mode: 'view', textMode: 'svg',
    });
    editor.history.clear();
    const duplicateSamples = [];
    const undoSamples = [];
    for (let index = 0; index < 40; index++) {
      let started = performance.now();
      const duplicated = editor.exec({ type: 'DuplicateSlide', id: sourceId });
      duplicateSamples.push(performance.now() - started);
      if (![...duplicated.createdSlides][0] || editor.doc.slideOrder.length !== 201
        || tailView.slideId !== tailId) throw new Error('200 页复制反馈不完整');
      started = performance.now();
      editor.undo();
      undoSamples.push(performance.now() - started);
      if (editor.doc.slideOrder.length !== 200) throw new Error('200 页复制撤销未恢复页序');
    }
    const duplicateP95 = percentile95(duplicateSamples);
    const undoP95 = percentile95(undoSamples);
    if (editor.doc.slides[sourceId].children.length < 60) throw new Error('复制性能固件不足 60 元素');
    recordPerformanceBudget('200 页/60 元素复制 p95', duplicateP95, 16);
    recordPerformanceBudget('200 页/60 元素复制撤销 p95', undoP95, 16);
    return { duplicateP95, undoP95, pageCount: 200 };
  } finally {
    performanceSession.dispose();
    perfMount.remove();
  }
}
