const percentile95 = (samples) => {
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length * 0.95)];
};

const byName = (session, slideId, name) => session.editor.doc.slides[slideId].children
  .map((id) => session.editor.doc.elements[id])
  .find((record) => record.src.name === name);

/** 真实 Chrome 验证同页多视图、无关页 DOM 身份与 200 页完整上屏预算。 */
export async function runEditorChangeLayoutBrowserContract({ openEditor, load }) {
  const editMount = document.createElement('div');
  const mirrorMount = document.createElement('div');
  const otherMount = document.createElement('div');
  editMount.className = mirrorMount.className = otherMount.className = 'contract-offscreen';
  document.body.append(editMount, mirrorMount, otherMount);
  const session = await openEditor(await load('sample-editor-change-layout.pptx'), {
    idPrefix: 'browser-change-layout-', historyLimit: 300,
  });
  try {
    const slideId = session.editor.doc.slideOrder[0];
    const sourceLayout = session.editor.doc.layoutOrder.find((id) =>
      session.editor.doc.layouts[id].name === '标题和正文');
    const targetLayout = session.editor.doc.layoutOrder.find((id) =>
      session.editor.doc.layouts[id].name === '重点内容');
    const added = session.editor.exec({ type: 'AddSlide', layoutId: sourceLayout, at: { after: slideId } });
    const otherSlide = [...added.createdSlides][0];
    session.editor.history.clear();

    const editView = session.mount(editMount, {
      slideId, mode: 'edit', textMode: 'svg', snapping: false,
    });
    const mirrorView = session.mount(mirrorMount, {
      slideId, mode: 'view', textMode: 'svg', snapping: false,
    });
    session.mount(otherMount, {
      slideId: otherSlide, mode: 'edit', textMode: 'svg', snapping: false,
    });
    const title = byName(session, slideId, '现有标题');
    session.editor.select({ kind: 'elements', ids: [title.id], enteredGroup: null });
    const editStatic = editMount.querySelector('[data-ppt-layer="static"]');
    const mirrorStatic = mirrorMount.querySelector('[data-ppt-layer="static"]');
    const otherStatic = otherMount.querySelector('[data-ppt-layer="static"]');
    const editBefore = editStatic.querySelector('svg');
    const mirrorBefore = mirrorStatic.querySelector('svg');
    const otherBefore = otherStatic.querySelector('svg');

    if (editView.queryLayout().value !== sourceLayout
      || mirrorView.setLayout(targetLayout) !== false
      || editView.queryLayout().value !== sourceLayout
      || editView.setLayout(targetLayout) !== true) {
      throw new Error('公开版式查询或 edit/view 命令边界失败');
    }
    const editAfter = editStatic.querySelector('svg');
    const mirrorAfter = mirrorStatic.querySelector('svg');
    const editTitle = editStatic.querySelector(`[data-edit-id="${title.id}"]`);
    const mirrorTitle = mirrorStatic.querySelector(`[data-edit-id="${title.id}"]`);
    const targetGhost = editMount.querySelector(
      '[data-edit-layout-placeholder][data-edit-layout-placeholder-idx="5"]',
    );
    const virtualStatic = editStatic.querySelector('[data-el="110"]');
    if (editAfter === editBefore || mirrorAfter === mirrorBefore
      || otherStatic.querySelector('svg') !== otherBefore
      || !editTitle || !mirrorTitle || !targetGhost
      || mirrorMount.querySelector('[data-edit-layout-placeholder]')
      || editStatic.querySelector('[data-edit-layout-placeholder]')
      || virtualStatic?.hasAttribute('data-edit-id')
      || session.editor.doc.slides[slideId].children.some((id) =>
        session.editor.doc.elements[id].meta.ph?.idx === '5')
      || session.editor.selection.kind !== 'elements'
      || session.editor.selection.ids[0] !== title.id
      || editView.queryLayout().value !== targetLayout
      || editView.queryLayout().source !== sourceLayout
      || !editView.queryLayout().direct) {
      throw new Error('换版式的多视图上屏、交互层或稳定身份失败');
    }
    const titleRect = editMount.querySelector('[data-edit-selection-frame]').getBoundingClientRect();
    const stageRect = editMount.querySelector('[data-ppt-stage]').getBoundingClientRect();
    const geometryError = Math.max(
      Math.abs(titleRect.left - stageRect.left - 260),
      Math.abs(titleRect.top - stageRect.top - 46),
      Math.abs(titleRect.width - 820),
      Math.abs(titleRect.height - 88),
    );
    if (geometryError > 0.5) {
      throw new Error(`目标版式标题几何未上屏：${geometryError.toFixed(3)}px`);
    }
    session.editor.undo();
    if (editView.queryLayout().value !== sourceLayout
      || editStatic.querySelector('svg') === editAfter
      || mirrorStatic.querySelector('svg') === mirrorAfter
      || otherStatic.querySelector('svg') !== otherBefore) {
      throw new Error('换版式撤销没有恢复投影或误绘无关页');
    }
    session.editor.redo();
    if (editView.queryLayout().value !== targetLayout) throw new Error('换版式重做未恢复目标版式');
  } finally {
    session.dispose();
    editMount.remove();
    mirrorMount.remove();
    otherMount.remove();
  }

  const performanceMount = document.createElement('div');
  performanceMount.className = 'contract-offscreen';
  document.body.append(performanceMount);
  const performanceSession = await openEditor(await load('sample-editor-change-layout.pptx'), {
    idPrefix: 'browser-change-layout-perf-', historyLimit: 300,
  });
  try {
    const slideId = performanceSession.editor.doc.slideOrder[0];
    const sourceLayout = performanceSession.editor.doc.layoutOrder.find((id) =>
      performanceSession.editor.doc.layouts[id].name === '标题和正文');
    const targetLayout = performanceSession.editor.doc.layoutOrder.find((id) =>
      performanceSession.editor.doc.layouts[id].name === '重点内容');
    let after = slideId;
    while (performanceSession.editor.doc.slideOrder.length < 200) {
      const result = performanceSession.editor.exec({
        type: 'AddSlide', layoutId: sourceLayout, at: { after },
      });
      after = [...result.createdSlides][0];
    }
    performanceSession.editor.history.clear();
    const view = performanceSession.mount(performanceMount, {
      slideId, mode: 'edit', textMode: 'svg', snapping: false,
    });
    const samples = [];
    for (let index = 0; index < 70; index++) {
      const started = performance.now();
      view.setLayout(index % 2 === 0 ? targetLayout : sourceLayout);
      performanceMount.querySelector('[data-ppt-layer="static"] svg').getBoundingClientRect();
      if (index >= 10) samples.push(performance.now() - started);
    }
    const feedbackP95 = percentile95(samples);
    if (performanceSession.editor.doc.slideOrder.length !== 200 || feedbackP95 > 16) {
      throw new Error(`200 页单页换版式完整上屏 p95 ${feedbackP95.toFixed(3)}ms`);
    }
    return { p95: feedbackP95, pageCount: performanceSession.editor.doc.slideOrder.length };
  } finally {
    performanceSession.dispose();
    performanceMount.remove();
  }
}
