const percentile95 = (samples) => {
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length * 0.95)];
};

const mountPoint = () => {
  const element = document.createElement('div');
  element.className = 'contract-offscreen';
  document.body.append(element);
  return element;
};

const ownedAnimations = (layer, host) => layer.getAnimations({ subtree: true })
  .filter((animation) => animation !== host);

const styleSnapshot = (layer) => [...layer.querySelectorAll('[data-el]')]
  .map((node) => node.getAttribute('style'));

const finish = (animations) => animations.forEach((animation) => animation.finish());

/** 真实 Chrome 证明 SVG WAAPI、完整时间线、框架 seam 与复杂页性能边界。 */
export async function runEditorAnimationBrowserContract({
  openEditor, createWebPptAdapter, load,
}) {
  const viewMount = mountPoint();
  const editMount = mountPoint();
  const adapterMount = mountPoint();
  const session = await openEditor(await load('sample-editor-animations.pptx'), {
    idPrefix: 'browser-animation-',
  });
  const [sourceSlide, plainSlide, perfSlide] = session.editor.doc.slideOrder;
  const view = session.mount(viewMount, {
    slideId: sourceSlide, mode: 'view', textMode: 'svg', snapping: false,
  });
  const edit = session.mount(editMount, {
    slideId: plainSlide, mode: 'edit', textMode: 'svg', snapping: false,
  });
  const viewLayer = viewMount.querySelector('[data-ppt-layer="static"]');
  const editLayer = editMount.querySelector('[data-ppt-layer="static"]');
  const source = view.queryAnimations();
  if (!viewLayer || !editLayer || view.animationPreview !== null
    || viewLayer.getAnimations({ subtree: true }).length !== 0
    || source.value.length !== 3 || !source.sourceReadonly
    || view.setAnimations([]) !== false || session.editor.isDirty()) {
    throw new Error('Chrome 动画初始查询、惰性挂载或查看权限边界失败');
  }

  const appearIn = view.previewAnimations([{
    target: source.value[0].target, kind: 'entrance', effect: 'appear', trigger: 'click',
    delayMs: 0, durationMs: 60,
  }]);
  const appearInAnimation = ownedAnimations(viewLayer)[0];
  if (appearInAnimation?.effect?.getTiming().easing !== 'steps(1, start)') {
    throw new Error('Chrome appear 入场错误退化成连续淡入');
  }
  finish([appearInAnimation]);
  await appearIn;
  const appearOut = view.previewAnimations([{
    target: source.value[0].target, kind: 'exit', effect: 'appear', trigger: 'click',
    delayMs: 0, durationMs: 60,
  }]);
  const appearOutAnimation = ownedAnimations(viewLayer)[0];
  const appearOutEasing = appearOutAnimation?.effect?.getTiming().easing;
  if (appearOutEasing !== 'steps(1, end)' && appearOutEasing !== 'steps(1)') {
    throw new Error('Chrome appear 退场错误提前隐藏或连续淡出');
  }
  finish([appearOutAnimation]);
  await appearOut;

  const historyBefore = session.editor.history.undoCount;
  const selectionBefore = JSON.stringify(session.editor.selection);
  const beforeSourceStyles = styleSnapshot(viewLayer);
  const hostAnimation = viewLayer.animate([{ opacity: 1 }, { opacity: 1 }], {
    duration: 10000, fill: 'both',
  });
  const hostFinished = hostAnimation.finished.catch(() => undefined);
  const sourcePreview = view.previewAnimations();
  const sourceAnimations = ownedAnimations(viewLayer, hostAnimation);
  if (sourceAnimations.length !== 3
    || sourceAnimations.some((animation) => animation.effect?.getTiming().duration < 60)
    || !sourceAnimations.some((animation) => {
      const frames = animation.effect?.getKeyframes() ?? [];
      return frames.some((frame) => String(frame.transform ?? '').includes('translate'));
    })) {
    throw new Error('Chrome 来源动画没有进入真实 SVG Web Animations 播放层');
  }
  finish(sourceAnimations);
  if (!await sourcePreview || hostAnimation.playState !== 'running'
    || JSON.stringify(styleSnapshot(viewLayer)) !== JSON.stringify(beforeSourceStyles)
    || session.editor.history.undoCount !== historyBefore
    || JSON.stringify(session.editor.selection) !== selectionBefore || session.editor.isDirty()) {
    throw new Error('Chrome 来源动画预览没有无损恢复样式或误写了模型');
  }

  const [plainA, plainB] = session.editor.doc.slides[plainSlide].children;
  const single = [{
    target: plainA, kind: 'entrance', effect: 'fly', dir: 'r', trigger: 'click',
    delayMs: 0, durationMs: 1000,
  }];
  const first = view.previewAnimations([{ ...single[0], target: source.value[0].target }]);
  const firstAnimations = ownedAnimations(viewLayer, hostAnimation);
  const second = view.previewAnimations([{ ...single[0], target: source.value[0].target, dir: 'l' }]);
  const secondAnimations = ownedAnimations(viewLayer, hostAnimation);
  if (!firstAnimations.length || firstAnimations.some((animation) => animation.playState !== 'idle')
    || secondAnimations.length !== 1 || hostAnimation.playState !== 'running') {
    throw new Error('Chrome 连续元素动画预览取消了宿主动画或没有回收旧任务');
  }
  finish(secondAnimations);
  if (!(await first) || !(await second)) throw new Error('Chrome 连续预览 Promise 未安全收束');
  hostAnimation.cancel();
  await hostFinished;

  const timeline = [
    { target: plainA, kind: 'entrance', effect: 'wipe', dir: 'l', trigger: 'click', delayMs: 0, durationMs: 60 },
    { target: plainB, kind: 'emphasis', effect: 'spin', trigger: 'withPrev', delayMs: 0, durationMs: 60 },
    { target: plainA, kind: 'motion', trigger: 'afterPrev', delayMs: 0, durationMs: 60,
      motionPath: [[0, 0], [30, -10], [60, 15]] },
    { target: plainB, kind: 'exit', effect: 'fade', trigger: 'click', delayMs: 0, durationMs: 60 },
  ];
  const editSvg = editLayer.querySelector('svg');
  if (!edit.setAnimations(timeline) || edit.queryAnimations().value.length !== 4
    || !edit.queryAnimations().direct || editLayer.querySelector('svg') !== editSvg) {
    throw new Error('Chrome 动画编辑没有同步查询或误重绘静态 SVG');
  }
  const beforeEditStyles = styleSnapshot(editLayer);
  const interaction = editMount.querySelector('[data-ppt-layer="interaction"]');
  const text = editMount.querySelector('[data-ppt-layer="text"]');
  const timelinePreview = edit.previewAnimations();
  if (!interaction || !text || interaction.style.visibility !== 'hidden'
    || text.style.visibility !== 'hidden' || ownedAnimations(editLayer).length !== 3) {
    throw new Error('Chrome 编辑态首个点击组没有播放或编辑 chrome 未隐藏');
  }
  if (!await timelinePreview || interaction.style.visibility !== '' || text.style.visibility !== ''
    || ownedAnimations(editLayer).length !== 0
    || JSON.stringify(styleSnapshot(editLayer)) !== JSON.stringify(beforeEditStyles)) {
    throw new Error('Chrome 一键完整时间线没有自动推进或无损恢复');
  }
  if (!edit.setAnimations(null) || edit.queryAnimations().direct
    || !edit.setAnimations([]) || edit.queryAnimations().value.length !== 0) {
    throw new Error('Chrome 元素动画恢复来源/显式删除语义失败');
  }

  const adapter = createWebPptAdapter();
  adapter.attach(adapterMount);
  await adapter.applyBinding({
    session, sessionOwnership: 'external', slideId: plainSlide, mode: 'edit', textMode: 'svg',
  });
  if (adapter.queryAnimations()?.value.length !== 0 || !adapter.setAnimations(single)) {
    throw new Error('Chrome adapter 无法查询或编辑动画');
  }
  adapter.setView({ mode: 'view' });
  if (adapter.setAnimations([]) !== false) throw new Error('Chrome adapter 查看模式越权编辑动画');
  const adapterPreview = adapter.previewAnimations();
  const adapterLayer = adapterMount.querySelector('[data-ppt-layer="static"]');
  const adapterAnimations = ownedAnimations(adapterLayer);
  if (adapterAnimations.length !== 1) throw new Error('Chrome adapter 没有复用动画预览控制器');
  finish(adapterAnimations);
  if (!await adapterPreview) throw new Error('Chrome adapter 动画预览未完成');
  adapter.dispose();

  const perfMount = mountPoint();
  const perfView = session.mount(perfMount, {
    slideId: perfSlide, mode: 'edit', textMode: 'svg', snapping: false,
  });
  const perfLayer = perfMount.querySelector('[data-ppt-layer="static"]');
  const perfTargets = session.editor.doc.slides[perfSlide].children;
  const perfSteps = perfTargets.map((target, index) => ({
    target, kind: 'entrance', effect: index % 2 ? 'fade' : 'wipe',
    ...(index % 2 ? {} : { dir: 'l' }), trigger: index ? 'withPrev' : 'click',
    delayMs: 0, durationMs: 60,
  }));
  if (!perfLayer || perfTargets.length !== 60) throw new Error('Chrome 60 元素动画固件不完整');
  const previewSamples = [];
  const previews = [];
  for (let index = 0; index < 40; index++) {
    const started = performance.now();
    previews.push(perfView.previewAnimations(perfSteps));
    previewSamples.push(performance.now() - started);
  }
  finish(ownedAnimations(perfLayer));
  if ((await Promise.all(previews)).some((played) => !played)) {
    throw new Error('Chrome 60 元素连续预览未安全收束');
  }
  const previewP95 = percentile95(previewSamples);

  while (session.editor.doc.slideOrder.length < 200) {
    session.editor.exec({ type: 'DuplicateSlide', id: plainSlide });
  }
  const ids = [...session.editor.doc.slideOrder];
  const batchSamples = [];
  for (let index = 0; index < 40; index++) {
    const started = performance.now();
    session.editor.transaction((transaction) => {
      for (const slideId of ids) {
        const target = session.editor.doc.slides[slideId].children[0];
        transaction.exec({
          type: 'SetAnimations', slideId,
          steps: [{ target, kind: 'entrance', effect: index % 2 ? 'fade' : 'appear',
            trigger: 'click', delayMs: 0, durationMs: 60 + index }],
        });
      }
    }, '批量元素动画');
    batchSamples.push(performance.now() - started);
  }
  const feedbackSvg = perfLayer.querySelector('svg');
  const feedbackSamples = [];
  for (let index = 0; index < 40; index++) {
    const started = performance.now();
    perfView.setAnimations(index % 2 ? perfSteps : perfSteps.slice(0, 30));
    feedbackSamples.push(performance.now() - started);
  }
  const batchP95 = percentile95(batchSamples);
  const feedbackP95 = percentile95(feedbackSamples);
  if (previewP95 > 16 || batchP95 > 16 || feedbackP95 > 16
    || perfLayer.querySelector('svg') !== feedbackSvg) {
    throw new Error(`Chrome 动画启动/200页批量/单页反馈 p95 ${previewP95.toFixed(3)}/${batchP95.toFixed(3)}/${feedbackP95.toFixed(3)}ms`);
  }

  session.dispose();
  viewMount.remove();
  editMount.remove();
  adapterMount.remove();
  perfMount.remove();
  console.info(`60 元素动画启动 p95 ${previewP95.toFixed(3)}ms`);
  console.info(`200 页动画批量/单页反馈 p95 ${batchP95.toFixed(3)}/${feedbackP95.toFixed(3)}ms`);
  return { previewP95, batchP95, feedbackP95 };
}
