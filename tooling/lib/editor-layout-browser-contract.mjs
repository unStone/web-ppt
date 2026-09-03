import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const percentile95 = (samples) => {
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length * 0.95)];
};

/** 真实 Chrome 验证设计画布身份、共享版式传播边界与大文稿提交预算。 */
export async function runEditorLayoutBrowserContract({ openEditor, createDesignEditor, load }) {
  const designMount = document.createElement('div');
  const firstMount = document.createElement('div');
  const secondMount = document.createElement('div');
  const otherMount = document.createElement('div');
  for (const node of [designMount, firstMount, secondMount, otherMount]) {
    node.className = 'contract-offscreen';
  }
  document.body.append(designMount, firstMount, secondMount, otherMount);
  const session = await openEditor(await load('sample-editor-change-layout.pptx'), {
    idPrefix: 'browser-layout-', historyLimit: 300,
  });
  let design = null;
  try {
    const first = session.editor.doc.slideOrder[0];
    const sourceLayout = session.editor.doc.slides[first].layoutId;
    const otherLayout = session.editor.doc.layoutOrder.find((id) => id !== sourceLayout);
    const second = [...session.editor.exec({
      type: 'AddSlide', layoutId: sourceLayout, at: { after: first },
    }).createdSlides][0];
    const other = [...session.editor.exec({
      type: 'AddSlide', layoutId: otherLayout, at: { after: second },
    }).createdSlides][0];
    const target = { kind: 'layout', id: sourceLayout };
    design = createDesignEditor(designMount, session, { target, textMode: 'svg' });
    session.editor.exec({
      type: 'SetSlideSize',
      w: session.editor.doc.meta.width + 16,
      h: session.editor.doc.meta.height + 9,
    });
    if (designMount.querySelector('svg')?.getAttribute('viewBox')
      !== `0 0 ${session.editor.doc.meta.width} ${session.editor.doc.meta.height}`) {
      throw new Error('版式设计画布没有同步文档尺寸');
    }
    const layoutRecord = session.editor.doc.layouts[sourceLayout];
    const lastLink = layoutRecord.children.map((id) => session.editor.doc.elements[id])
      .find((record) => record.src.name === '版式末页链接');
    const lastLinkTarget = () => designMount
      .querySelector(`[data-edit-id="${lastLink.id}"]`)?.closest('a')?.getAttribute('data-slide');
    if (lastLinkTarget() !== '3') throw new Error('版式设计画布初始页链接上下文错误');
    session.editor.exec({ type: 'AddSlide', layoutId: otherLayout, at: { after: other } });
    if (lastLinkTarget() !== '4') throw new Error('版式设计画布没有同步页树链接上下文');
    session.mount(firstMount, { slideId: first, mode: 'edit', textMode: 'svg', snapping: false });
    session.mount(secondMount, { slideId: second, mode: 'edit', textMode: 'svg', snapping: false });
    session.mount(otherMount, { slideId: other, mode: 'edit', textMode: 'svg', snapping: false });
    const stripe = layoutRecord.children.map((id) => session.editor.doc.elements[id])
      .find((record) => record.src.name === '版式色带');
    const designNode = designMount.querySelector(`[data-edit-id="${stripe.id}"]`);
    const designSvg = designMount.querySelector('svg');
    const firstSvg = firstMount.querySelector('[data-ppt-layer="static"] svg');
    const secondSvg = secondMount.querySelector('[data-ppt-layer="static"] svg');
    const otherSvg = otherMount.querySelector('[data-ppt-layer="static"] svg');
    design.exec({ type: 'SetXfrm', id: stripe.id, x: stripe.src.x + 31 });
    const nextDesignNode = designMount.querySelector(`[data-edit-id="${stripe.id}"]`);
    if (designMount.querySelector('svg') === designSvg || nextDesignNode === designNode
      || firstMount.querySelector('[data-ppt-layer="static"] svg') === firstSvg
      || secondMount.querySelector('[data-ppt-layer="static"] svg') === secondSvg
      || otherMount.querySelector('[data-ppt-layer="static"] svg') !== otherSvg
      || session.editor.toSlide(first).elements.find((element) => element.name === '版式色带')?.x
        !== stripe.src.x + 31
      || !nextDesignNode) {
      throw new Error('版式设计画布身份或共享版式局部传播失败');
    }
  } finally {
    design?.destroy();
    session.dispose();
    designMount.remove();
    firstMount.remove();
    secondMount.remove();
    otherMount.remove();
  }

  const performanceMount = document.createElement('div');
  performanceMount.className = 'contract-offscreen';
  document.body.append(performanceMount);
  const performanceSession = await openEditor(await load('sample-editor-change-layout.pptx'), {
    idPrefix: 'browser-layout-perf-', historyLimit: 300,
  });
  let performanceDesign = null;
  try {
    const first = performanceSession.editor.doc.slideOrder[0];
    const layoutId = performanceSession.editor.doc.slides[first].layoutId;
    let after = first;
    while (performanceSession.editor.doc.slideOrder.length < 200) {
      after = [...performanceSession.editor.exec({
        type: 'AddSlide', layoutId, at: { after },
      }).createdSlides][0];
    }
    performanceSession.editor.history.clear();
    const target = { kind: 'layout', id: layoutId };
    performanceDesign = createDesignEditor(
      performanceMount, performanceSession, { target, textMode: 'svg' },
    );
    const stripe = performanceSession.editor.doc.layouts[layoutId].children
      .map((id) => performanceSession.editor.doc.elements[id])
      .find((record) => record.src.name === '版式色带');
    const samples = [];
    for (let index = 0; index < 70; index++) {
      const started = performance.now();
      performanceDesign.exec({ type: 'SetXfrm', id: stripe.id, x: stripe.src.x + index + 1 });
      performanceMount.querySelector('svg').getBoundingClientRect();
      if (index >= 10) samples.push(performance.now() - started);
    }
    const feedbackP95 = percentile95(samples);
    recordPerformanceBudget('200 页共享版式编辑上屏 p95', feedbackP95, 16);
    return { p95: feedbackP95, pageCount: performanceSession.editor.doc.slideOrder.length };
  } finally {
    performanceDesign?.destroy();
    performanceSession.dispose();
    performanceMount.remove();
  }
}
