import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const percentile95 = (samples) => {
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length * 0.95)];
};

/** 真实 Chrome 验证主题整页上屏、无关主题 DOM 身份与大文稿提交预算。 */
export async function runEditorThemeBrowserContract({ openEditor, listThemes, load }) {
  const sourceMount = document.createElement('div');
  const otherMount = document.createElement('div');
  sourceMount.className = otherMount.className = 'contract-offscreen';
  document.body.append(sourceMount, otherMount);
  const session = await openEditor(await load('sample-editor-theme.pptx'), {
    idPrefix: 'browser-theme-', historyLimit: 300,
  });
  try {
    const sourceSlide = session.editor.doc.slideOrder[0];
    const themes = listThemes(session.editor.doc);
    const sourceTheme = themes.find((theme) => theme.name === 'Add Slide Theme');
    const otherTheme = themes.find((theme) => theme.name === 'Target Layout Theme');
    const otherLayout = session.editor.doc.layoutOrder.find((id) =>
      session.editor.doc.layouts[id].themeId === otherTheme.id);
    const otherSlide = [...session.editor.exec({
      type: 'AddSlide', layoutId: otherLayout, at: { after: sourceSlide },
    }).createdSlides][0];
    const sourceView = session.mount(sourceMount, {
      slideId: sourceSlide, mode: 'edit', textMode: 'svg', snapping: false,
    });
    session.mount(otherMount, {
      slideId: otherSlide, mode: 'edit', textMode: 'svg', snapping: false,
    });
    const sourceStatic = sourceMount.querySelector('[data-ppt-layer="static"]');
    const otherStatic = otherMount.querySelector('[data-ppt-layer="static"]');
    const sourceSvg = sourceStatic.querySelector('svg');
    const otherSvg = otherStatic.querySelector('svg');
    const sourceRecord = Object.values(session.editor.doc.elements)
      .find((record) => record.parent === sourceSlide && record.src.name === '普通业务形状');
    const sourceNode = sourceStatic.querySelector(`[data-edit-id="${sourceRecord.id}"]`);
    session.editor.exec({
      type: 'SetTheme', id: sourceTheme.id,
      clrScheme: { accent1: '#112233' }, fontScheme: { minor: { latin: 'Theme Browser Latin' } },
    });
    const sourceAfter = sourceStatic.querySelector('svg');
    const sourceNodeAfter = sourceStatic.querySelector(`[data-edit-id="${sourceRecord.id}"]`);
    if (sourceAfter === sourceSvg || sourceNodeAfter === sourceNode
      || otherStatic.querySelector('svg') !== otherSvg
      || !sourceNodeAfter?.outerHTML.includes('rgb(17,34,51)')
      || !sourceNodeAfter?.outerHTML.includes('Theme Browser Latin')) {
      throw new Error('主题上屏、字体传播或无关主题 DOM 身份失败');
    }
    session.editor.undo();
    if (sourceStatic.querySelector('svg') === sourceAfter
      || otherStatic.querySelector('svg') !== otherSvg
      || session.editor.toSlide(sourceSlide).elements.find((element) => element.name === '普通业务形状')
        ?.fill?.color !== 'rgb(217,79,112)') {
      throw new Error('主题撤销没有恢复来源投影或误绘无关主题');
    }
  } finally {
    session.dispose();
    sourceMount.remove();
    otherMount.remove();
  }

  const performanceMount = document.createElement('div');
  performanceMount.className = 'contract-offscreen';
  document.body.append(performanceMount);
  const performanceSession = await openEditor(await load('sample-editor-theme.pptx'), {
    idPrefix: 'browser-theme-perf-', historyLimit: 300,
  });
  try {
    const slideId = performanceSession.editor.doc.slideOrder[0];
    const themes = listThemes(performanceSession.editor.doc);
    const sourceTheme = themes.find((theme) => theme.name === 'Add Slide Theme');
    const sourceLayout = performanceSession.editor.doc.layouts[
      performanceSession.editor.doc.slides[slideId].layoutId
    ].id;
    const otherLayout = performanceSession.editor.doc.layoutOrder.find((id) =>
      performanceSession.editor.doc.layouts[id].themeId !== sourceTheme.id);
    let after = slideId;
    while (performanceSession.editor.doc.slideOrder.length < 200) {
      const count = performanceSession.editor.doc.slideOrder.length;
      after = [...performanceSession.editor.exec({
        type: 'AddSlide', layoutId: count % 2 ? otherLayout : sourceLayout, at: { after },
      }).createdSlides][0];
    }
    performanceSession.editor.history.clear();
    performanceSession.mount(performanceMount, {
      slideId, mode: 'edit', textMode: 'svg', snapping: false,
    });
    const samples = [];
    for (let index = 0; index < 70; index++) {
      const channel = (32 + index % 96).toString(16).padStart(2, '0');
      const started = performance.now();
      performanceSession.editor.exec({
        type: 'SetTheme', id: sourceTheme.id, clrScheme: { accent1: `#${channel}3344` },
      });
      performanceMount.querySelector('[data-ppt-layer="static"] svg').getBoundingClientRect();
      if (index >= 10) samples.push(performance.now() - started);
    }
    const feedbackP95 = percentile95(samples);
    recordPerformanceBudget('200 页局部主题整页上屏 p95', feedbackP95, 16);
    return { p95: feedbackP95, pageCount: performanceSession.editor.doc.slideOrder.length };
  } finally {
    performanceSession.dispose();
    performanceMount.remove();
  }
}
