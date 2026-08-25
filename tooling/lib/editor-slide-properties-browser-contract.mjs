import { querySlideBackground, querySlideHidden } from '/out/editor/editor.mjs';

const percentile95 = (samples) => {
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length * 0.95)];
};

/** 真实浏览器验证整页背景上屏、隐藏元数据零重绘与 200 页批量预算。 */
export async function runEditorSlidePropertiesBrowserContract({ openEditor, load }) {
  const firstMount = document.createElement('div');
  const mirrorMount = document.createElement('div');
  const otherMount = document.createElement('div');
  firstMount.className = mirrorMount.className = otherMount.className = 'contract-offscreen';
  document.body.append(firstMount, mirrorMount, otherMount);
  const session = await openEditor(await load('sample-editor-slide-properties.pptx'), {
    idPrefix: 'browser-slide-properties-',
  });
  const [first, second] = session.editor.doc.slideOrder;
  session.mount(firstMount, { slideId: first, mode: 'edit', textMode: 'svg', snapping: false });
  session.mount(mirrorMount, { slideId: first, mode: 'view', textMode: 'svg', snapping: false });
  session.mount(otherMount, { slideId: second, mode: 'edit', textMode: 'svg', snapping: false });
  const firstStatic = firstMount.querySelector('[data-ppt-layer="static"]');
  const mirrorStatic = mirrorMount.querySelector('[data-ppt-layer="static"]');
  const otherStatic = otherMount.querySelector('[data-ppt-layer="static"]');
  const firstBefore = firstStatic.querySelector('svg');
  const mirrorBefore = mirrorStatic.querySelector('svg');
  const otherBefore = otherStatic.querySelector('svg');
  session.editor.exec({
    type: 'SetBackground', id: first,
    fill: {
      type: 'gradient', angle: 45,
      stops: [{ pos: 0, color: '#DBEAFE' }, { pos: 1, color: '#1D4ED8' }],
    },
  });
  const firstAfter = firstStatic.querySelector('svg');
  const mirrorAfter = mirrorStatic.querySelector('svg');
  if (firstAfter === firstBefore || mirrorAfter === mirrorBefore
    || otherStatic.querySelector('svg') !== otherBefore
    || !firstAfter?.querySelector('linearGradient')
    || !querySlideBackground(session.editor.doc, [first]).direct) {
    throw new Error('Chrome 页面背景整页上屏或无关页 DOM 身份失败');
  }
  session.editor.exec({ type: 'SetHidden', id: first, v: true });
  if (!querySlideHidden(session.editor.doc, [first]).value
    || firstStatic.querySelector('svg') !== firstAfter
    || mirrorStatic.querySelector('svg') !== mirrorAfter
    || otherStatic.querySelector('svg') !== otherBefore) {
    throw new Error('Chrome 页面隐藏状态触发了无意义重绘或查询未同步');
  }

  while (session.editor.doc.slideOrder.length < 200) {
    session.editor.exec({ type: 'DuplicateSlide', id: second });
  }
  const ids = [...session.editor.doc.slideOrder];
  const batchSamples = [];
  for (let index = 0; index < 40; index++) {
    const started = performance.now();
    session.editor.transaction((transaction) => {
      for (const id of ids) transaction.exec({ type: 'SetHidden', id, v: index % 2 === 0 });
    }, '批量页面隐藏');
    batchSamples.push(performance.now() - started);
  }
  const renderSamples = [];
  for (let index = 0; index < 40; index++) {
    const started = performance.now();
    session.editor.exec({
      type: 'SetBackground', id: first,
      fill: { type: 'solid', color: index % 2 ? '#0F172A' : '#F8FAFC' },
    });
    renderSamples.push(performance.now() - started);
  }
  const batchP95 = percentile95(batchSamples);
  const renderP95 = percentile95(renderSamples);
  if (ids.length !== 200 || batchP95 > 16 || renderP95 > 16) {
    throw new Error(`Chrome 200 页批量/单页上屏 p95 ${batchP95.toFixed(3)}/${renderP95.toFixed(3)}ms`);
  }
  session.dispose();
  firstMount.remove();
  mirrorMount.remove();
  otherMount.remove();
  console.info(`200 页属性批量/单页上屏 p95 ${batchP95.toFixed(3)}/${renderP95.toFixed(3)}ms`);
  return { batchP95, renderP95 };
}
