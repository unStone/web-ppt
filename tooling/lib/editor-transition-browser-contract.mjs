import {
  SLIDE_TRANSITION_TYPES, transitionDirections,
} from '/out/editor/editor.mjs';

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

const playableInput = (type) => {
  const directions = transitionDirections(type);
  return {
    type, durationMs: 80,
    ...(directions[0] ? { dir: directions[0] } : {}),
    ...(type === 'morph' ? { morphBy: 'byWord' } : {}),
  };
};

const previewNode = (mount) => mount.querySelector('[data-ppt-transition-preview]');

const ownedAnimations = (layer, mount, host) => [
  ...layer.getAnimations({ subtree: true }),
  ...(previewNode(mount)?.getAnimations({ subtree: true }) ?? []),
].filter((animation) => animation !== host);

const visuallyChanges = (animation) => {
  const frames = animation.effect?.getKeyframes() ?? [];
  const first = frames[0] ?? {};
  const last = frames.at(-1) ?? {};
  return ['opacity', 'transform', 'clipPath', 'filter']
    .some((property) => JSON.stringify(first[property]) !== JSON.stringify(last[property]));
};

const animationSignature = (animations) => animations.map((animation) =>
  JSON.stringify((animation.effect?.getKeyframes() ?? []).map((frame) => ({
    opacity: frame.opacity, transform: frame.transform, clipPath: frame.clipPath,
    filter: frame.filter, transformOrigin: frame.transformOrigin,
  })))).join('|');

/** 真实 Chrome 同时证明 Web Animations、权限、多视图、adapter 与性能边界。 */
export async function runEditorTransitionBrowserContract({
  openEditor, createWebPptAdapter, load,
}) {
  const viewMount = mountPoint();
  const editMount = mountPoint();
  const adapterMount = mountPoint();
  const session = await openEditor(await load('sample-editor-transitions.pptx'), {
    idPrefix: 'browser-transition-',
  });
  const fade = session.editor.doc.slideOrder[1];
  const view = session.mount(viewMount, {
    slideId: fade, mode: 'view', textMode: 'svg', snapping: false,
  });
  const edit = session.mount(editMount, {
    slideId: fade, mode: 'edit', textMode: 'svg', snapping: false,
  });
  const viewLayer = viewMount.querySelector('[data-ppt-layer="static"]');
  const editLayer = editMount.querySelector('[data-ppt-layer="static"]');
  if (!viewLayer || !editLayer || viewLayer.getAnimations().length !== 0
    || editLayer.getAnimations().length !== 0 || view.queryTransition().value?.type !== 'fade'
    || view.queryTransition().value?.durationMs !== 800 || previewNode(viewMount)) {
    throw new Error('Chrome 切换初始查询错误或挂载时发生了意外自动播放');
  }
  if (view.setTransition({ type: 'cut' }) !== false || session.editor.isDirty()) {
    throw new Error('Chrome 查看模式越权修改了页面切换');
  }

  const historyBefore = session.editor.history.undoCount;
  const selectionBefore = JSON.stringify(session.editor.selection);
  const hostAnimation = viewLayer.animate([{ opacity: 1 }, { opacity: 1 }], {
    duration: 10000, fill: 'both',
  });
  const hostFinished = hostAnimation.finished.catch(() => undefined);
  const sourcePreview = view.previewTransition();
  const sourceAnimations = ownedAnimations(viewLayer, viewMount, hostAnimation);
  const sourceAnimation = sourceAnimations.find((animation) => {
    const frames = animation.effect?.getKeyframes() ?? [];
    return frames[0]?.opacity === '0' && frames.at(-1)?.opacity === '1';
  });
  const sourceTiming = sourceAnimation?.effect?.getTiming();
  const sourceFrames = sourceAnimation?.effect?.getKeyframes() ?? [];
  if (!previewNode(viewMount) || previewNode(viewMount).children.length !== 0
    || sourceAnimations.length !== 2
    || !sourceAnimation || sourceTiming?.duration !== 800
    || sourceFrames[0]?.opacity !== '0' || sourceFrames.at(-1)?.opacity !== '1') {
    throw new Error('Chrome 没有用来源时长与真实 Web Animations 关键帧预览 fade');
  }

  const previewSamples = [];
  const previews = [sourcePreview];
  let previous = sourceAnimations;
  for (const type of SLIDE_TRANSITION_TYPES) {
    if (type === 'none') continue;
    const started = performance.now();
    const preview = view.previewTransition(playableInput(type));
    previewSamples.push(performance.now() - started);
    previews.push(preview);
    const active = ownedAnimations(viewLayer, viewMount, hostAnimation);
    if (!previewNode(viewMount) || previous.some((animation) => animation.playState !== 'idle')
      || hostAnimation.playState !== 'running' || active.length === 0
      || active.some((animation) => animation.effect?.getTiming().duration !== 80)
      || !active.some(visuallyChanges)) {
      throw new Error(`Chrome 连续预览没有取消旧动画或 ${type} 没有进入播放层`);
    }
    previous = active;
  }
  for (const type of SLIDE_TRANSITION_TYPES) {
    const directions = transitionDirections(type);
    if (directions.length < 2) continue;
    const signatures = new Set();
    for (const dir of directions) {
      const preview = view.previewTransition({ type, dir, durationMs: 80 });
      previews.push(preview);
      const active = ownedAnimations(viewLayer, viewMount, hostAnimation);
      signatures.add(animationSignature(active));
    }
    if (signatures.size !== directions.length) {
      throw new Error(`Chrome ${type} 的公开方向存在视觉相同关键帧`);
    }
  }
  const previewResults = await Promise.all(previews);
  const previewP95 = percentile95(previewSamples);
  const remaining = viewLayer.getAnimations({ subtree: true });
  if (previewResults.some((played) => !played)
    || remaining.length !== 1 || remaining[0] !== hostAnimation
    || previewNode(viewMount)
    || previewP95 > 16 || session.editor.history.undoCount !== historyBefore
    || JSON.stringify(session.editor.selection) !== selectionBefore || session.editor.isDirty()) {
    throw new Error(`Chrome 40 种切换预览或零副作用边界失败，启动 p95 ${previewP95.toFixed(3)}ms`);
  }
  hostAnimation.cancel();
  await hostFinished;
  if (await view.previewTransition({ type: 'none' }) !== false) {
    throw new Error('Chrome none 切换不应产生播放任务');
  }

  const interactionLayer = editMount.querySelector('[data-ppt-layer="interaction"]');
  const textLayer = editMount.querySelector('[data-ppt-layer="text"]');
  const selectedId = session.editor.doc.slides[fade].children[0];
  session.editor.select({ kind: 'elements', ids: [selectedId], enteredGroup: null });
  const editSelection = JSON.stringify(session.editor.selection);
  const editPreview = edit.previewTransition({ type: 'doors', dir: 'vert', durationMs: 80 });
  const editOutgoing = previewNode(editMount);
  if (!interactionLayer || !textLayer || !editOutgoing
    || interactionLayer.style.visibility !== 'hidden' || textLayer.style.visibility !== 'hidden'
    || editLayer.getAnimations().length !== 1 || editOutgoing.getAnimations().length !== 1) {
    throw new Error('Chrome edit 模式预览没有播放双层动画或临时隐藏编辑控件');
  }
  if (!await editPreview || interactionLayer.style.visibility !== ''
    || textLayer.style.visibility !== '' || JSON.stringify(session.editor.selection) !== editSelection
    || previewNode(editMount)) {
    throw new Error('Chrome edit 模式预览结束后没有无损恢复编辑控件与选区');
  }

  const viewSvg = viewLayer.querySelector('svg');
  const editSvg = editLayer.querySelector('svg');
  if (!edit.setTransition({
    type: 'morph', durationMs: 900, morphBy: 'byChar', advanceAfterMs: 3000,
  }) || view.queryTransition().value?.type !== 'morph'
    || view.queryTransition().value?.morphBy !== 'byChar'
    || viewLayer.querySelector('svg') !== viewSvg || editLayer.querySelector('svg') !== editSvg) {
    throw new Error('Chrome 编辑/多视图查询未同步，或元数据修改触发了静态 SVG 重绘');
  }
  if (!edit.setTransition(null) || edit.queryTransition().value?.type !== 'fade'
    || edit.queryTransition().direct) {
    throw new Error('Chrome 恢复来源切换失败');
  }

  const adapter = createWebPptAdapter();
  adapter.attach(adapterMount);
  await adapter.applyBinding({
    session, sessionOwnership: 'external', slideId: fade, mode: 'view', textMode: 'svg',
  });
  if (adapter.queryTransition()?.value?.type !== 'fade'
    || adapter.setTransition({ type: 'cut' }) !== false) {
    throw new Error('Chrome adapter 查询或查看权限边界失败');
  }
  const adapterPreview = adapter.previewTransition({ type: 'push', dir: 'r', durationMs: 80 });
  const adapterLayer = adapterMount.querySelector('[data-ppt-layer="static"]');
  const adapterOutgoing = previewNode(adapterMount);
  if (!adapterLayer || !adapterOutgoing
    || adapterLayer.getAnimations({ subtree: true }).length !== 1
    || adapterOutgoing.getAnimations({ subtree: true }).length !== 1
    || !await adapterPreview || previewNode(adapterMount)) {
    throw new Error('Chrome adapter 没有委托共享预览控制器');
  }
  adapter.setView({ mode: 'edit' });
  if (!adapter.setTransition({ type: 'cut', durationMs: 350 })
    || view.queryTransition().value?.type !== 'cut') {
    throw new Error('Chrome adapter 编辑动作没有同步到共享 session');
  }
  adapter.dispose();

  const complexMount = mountPoint();
  const complexSession = await openEditor(await load('sample-editor-60.pptx'), {
    idPrefix: 'browser-transition-complex-',
  });
  const complexView = complexSession.mount(complexMount, {
    mode: 'view', textMode: 'svg', snapping: false,
  });
  const complexLayer = complexMount.querySelector('[data-ppt-layer="static"]');
  if (!complexLayer || complexLayer.querySelectorAll('[data-edit-id]').length < 60) {
    throw new Error('Chrome 复杂页切换性能固件不完整');
  }
  const nativeAnimations = complexLayer.getAnimations.bind(complexLayer);
  Object.defineProperty(complexLayer, 'getAnimations', {
    configurable: true,
    value: (options) => {
      if (options?.subtree) throw new Error('切换预览不应扫描复杂静态层子树');
      return nativeAnimations(options);
    },
  });
  const complexSamples = [];
  const complexPreviews = [];
  for (let index = 0; index < 40; index++) {
    const started = performance.now();
    complexPreviews.push(complexView.previewTransition({
      type: index % 2 ? 'pull' : 'ripple',
      dir: index % 2 ? 'rd' : 'center', durationMs: 80,
    }));
    complexSamples.push(performance.now() - started);
  }
  const complexPreviewP95 = percentile95(complexSamples);
  if ((await Promise.all(complexPreviews)).some((played) => !played)
    || complexPreviewP95 > 16 || previewNode(complexMount)
    || complexSession.editor.isDirty()) {
    throw new Error(`Chrome 60 元素复杂页切换预览失败，启动 p95 ${complexPreviewP95.toFixed(3)}ms`);
  }
  complexSession.dispose();
  complexMount.remove();

  while (session.editor.doc.slideOrder.length < 200) {
    session.editor.exec({ type: 'DuplicateSlide', id: session.editor.doc.slideOrder[0] });
  }
  const ids = [...session.editor.doc.slideOrder];
  const batchSamples = [];
  for (let index = 0; index < 40; index++) {
    const started = performance.now();
    session.editor.transaction((transaction) => {
      const type = index % 2 ? 'flash' : 'cut';
      for (const id of ids) transaction.exec({
        type: 'SetTransition', id, t: { type, durationMs: 500 + index },
      });
    }, '批量页面切换');
    batchSamples.push(performance.now() - started);
  }
  const feedbackSamples = [];
  for (let index = 0; index < 40; index++) {
    const started = performance.now();
    edit.setTransition({ type: index % 2 ? 'fade' : 'cut', durationMs: 400 + index });
    feedbackSamples.push(performance.now() - started);
  }
  const batchP95 = percentile95(batchSamples);
  const feedbackP95 = percentile95(feedbackSamples);
  const measuredPreviewP95 = Math.max(previewP95, complexPreviewP95);
  if (ids.length !== 200 || batchP95 > 16 || feedbackP95 > 16) {
    throw new Error(`Chrome 200 页切换批量/单页反馈 p95 ${batchP95.toFixed(3)}/${feedbackP95.toFixed(3)}ms`);
  }

  session.dispose();
  viewMount.remove();
  editMount.remove();
  adapterMount.remove();
  console.info(`40 种切换启动 p95 ${previewP95.toFixed(3)}ms`);
  console.info(`60 元素复杂页切换启动 p95 ${complexPreviewP95.toFixed(3)}ms`);
  console.info(`200 页切换批量/单页反馈 p95 ${batchP95.toFixed(3)}/${feedbackP95.toFixed(3)}ms`);
  return { previewP95: measuredPreviewP95, batchP95, feedbackP95 };
}
