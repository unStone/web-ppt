function installAnimations(window) {
  const calls = [];
  const prototypes = [...new Set([
    window.HTMLElement.prototype,
    window.SVGElement?.prototype,
  ].filter(Boolean))];
  const originals = prototypes.map((prototype) => ({
    prototype,
    animate: prototype.animate,
    getAnimations: prototype.getAnimations,
  }));
  const active = new Map();
  const animate = function animate(frames, options) {
    let resolve;
    let reject;
    const finished = new Promise((yes, no) => { resolve = yes; reject = no; });
    const animation = {
      owner: this, finished, cancelled: false, completed: false,
      cancel() {
        if (this.cancelled || this.completed) return;
        this.cancelled = true;
        active.get(this.owner)?.delete(this);
        reject(new Error('cancelled'));
      },
      finish() {
        if (this.cancelled || this.completed) return;
        this.completed = true;
        active.get(this.owner)?.delete(this);
        resolve();
      },
    };
    const owned = active.get(this) ?? new Set();
    owned.add(animation);
    active.set(this, owned);
    calls.push({ owner: this, frames, options, animation });
    return animation;
  };
  const getAnimations = function getAnimations() { return [...(active.get(this) ?? [])]; };
  for (const prototype of prototypes) {
    prototype.animate = animate;
    prototype.getAnimations = getAnimations;
  }
  return {
    calls,
    restore() {
      for (const { prototype, animate: originalAnimate, getAnimations: originalGet } of originals) {
        if (originalAnimate) prototype.animate = originalAnimate;
        else delete prototype.animate;
        if (originalGet) prototype.getAnimations = originalGet;
        else delete prototype.getAnimations;
      }
    },
  };
}

/** 元素动画沿用 viewer-core 播放原语，编辑器只拥有一次预览的生命周期。 */
export async function runAnimationEditorContract({ lib, load, check, window }) {
  console.log('\n\x1b[36m▸ 元素动画 view/edit 即时预览\x1b[0m');
  const animations = installAnimations(window);
  try {
    const session = await lib.openEditor(load('sample-editor-animations.pptx'), {
      idPrefix: 'animation-editor-',
    });
    const [sourceSlide, plainSlide] = session.editor.doc.slideOrder;
    const [plainA, plainB] = session.editor.doc.slides[plainSlide].children;
    const viewMount = document.createElement('div');
    const editMount = document.createElement('div');
    const view = session.mount(viewMount, { slideId: sourceSlide, mode: 'view' });
    const edit = session.mount(editMount, { slideId: plainSlide, mode: 'edit' });
    const history = session.editor.history.undoCount;
    const selection = JSON.stringify(session.editor.selection);

    const source = view.queryAnimations();
    check('默认挂载不创建动画控制器且查询返回稳定身份来源',
      animations.calls.length === 0 && view.animationPreview === null
        && source.value.length === 3 && source.sourceReadonly
        && session.editor.doc.elements[source.value[0].target]?.parent === sourceSlide);
    check('查看模式能查询但不能修改元素动画', view.setAnimations([]) === false
      && !session.editor.isDirty());

    const host = document.createElement('div');
    const hostAnimation = host.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 999 });
    const first = view.previewAnimations();
    const firstCalls = animations.calls.slice(1);
    check('来源时间线在静态高保真层按同一点击组播放', firstCalls.length === 3
      && firstCalls.every((call) => call.owner.closest('[data-ppt-layer="static"]'))
      && firstCalls[0].options.duration === source.value[0].durationMs
      && view.animationPreview !== null,
    JSON.stringify(firstCalls.map((call) => ({
      target: call.owner.closest('[data-el]')?.getAttribute('data-el'),
      duration: call.options.duration,
    }))));
    const second = view.previewAnimations();
    const secondCalls = animations.calls.slice(4);
    check('连续预览只取消自己创建的 WAAPI', firstCalls.every((call) => call.animation.cancelled)
      && !hostAnimation.cancelled && secondCalls.length === 3,
    JSON.stringify({ first: firstCalls.length, second: secondCalls.length }));
    secondCalls.forEach((call) => call.animation.finish());
    check('预览结束恢复样式、编辑 chrome、模型与历史', await first && await second
      && editMount.querySelector('[data-ppt-layer="interaction"]').style.visibility === ''
      && session.editor.history.undoCount === history
      && JSON.stringify(session.editor.selection) === selection && !session.editor.isDirty());

    const steps = [
      { target: plainA, kind: 'entrance', effect: 'wipe', dir: 'l', trigger: 'click', delayMs: 0, durationMs: 400 },
      { target: plainB, kind: 'emphasis', effect: 'spin', trigger: 'withPrev', delayMs: 20, durationMs: 100 },
      { target: plainA, kind: 'motion', trigger: 'afterPrev', delayMs: 30, durationMs: 100,
        motionPath: [[0, 0], [20, 10]] },
      { target: plainB, kind: 'emphasis', effect: 'grow', trigger: 'withPrev', delayMs: 10, durationMs: 100 },
      { target: plainB, kind: 'exit', effect: 'fade', trigger: 'click', delayMs: 0, durationMs: 100 },
    ];
    check('编辑模式提交后同会话查询立即一致', edit.setAnimations(steps)
      && edit.queryAnimations().value.length === 5 && edit.queryAnimations().direct);
    const beforeStyles = [...editMount.querySelectorAll('[data-el]')]
      .map((node) => node.getAttribute('style'));
    const draft = edit.previewAnimations(steps);
    const draftFirst = animations.calls.slice(-4);
    check('草稿预览按紧邻前一步调度首个点击组并隐藏编辑 chrome', draftFirst.length === 4
      && draftFirst.map((call) => call.options.delay).join('|') === '0|20|150|160'
      && editMount.querySelector('[data-ppt-layer="interaction"]').style.visibility === 'hidden');
    draftFirst.forEach((call) => call.animation.finish());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const draftLast = animations.calls.at(-1);
    check('一键预览会自动串行推进全部点击组', draftLast && !draftFirst.includes(draftLast)
      && draftLast.options.duration === 100);
    draftLast.animation.finish();
    const draftFinished = await draft;
    const afterStyles = [...editMount.querySelectorAll('[data-el]')]
      .map((node) => node.getAttribute('style'));
    check('完整时间线播放后恢复所有内联样式', draftFinished
      && afterStyles.every((value, index) => value === beforeStyles[index]),
    JSON.stringify({ beforeStyles, afterStyles }));
    check('null 恢复来源而空数组明确删除', edit.setAnimations(null)
      && !edit.queryAnimations().direct && edit.setAnimations([])
      && edit.queryAnimations().direct && edit.queryAnimations().value.length === 0);

    const pending = edit.previewAnimations(steps);
    const pendingCalls = animations.calls.slice(-4);
    edit.destroy();
    check('销毁视图取消未完成动画并安全收束 Promise',
      pendingCalls.every((call) => call.animation.cancelled) && await pending);
    view.destroy();
    session.dispose();

    const adapter = lib.createWebPptAdapter();
    await adapter.setDocument({
      source: load('sample-editor-animations.pptx'),
      openOptions: { idPrefix: 'animation-adapter-' },
    });
    const adapterSlide = adapter.snapshot.session.editor.doc.slideOrder[1];
    const adapterTargets = adapter.snapshot.session.editor.doc.slides[adapterSlide].children;
    const adapterStep = [{
      target: adapterTargets[0], kind: 'entrance', effect: 'fade', trigger: 'click',
      delayMs: 0, durationMs: 100,
    }];
    adapter.setView({ slideId: adapterSlide, mode: 'edit' });
    check('无 DOM 的框架 adapter 仍可查询和编辑模型', adapter.queryAnimations().value.length === 0
      && adapter.setAnimations(adapterStep) && adapter.queryAnimations().value.length === 1
      && await adapter.previewAnimations() === false);
    adapter.setView({ mode: 'view' });
    check('adapter 查看权限不依赖 React/Vue 组件实例', adapter.setAnimations([]) === false);
    const adapterMount = document.createElement('div');
    adapter.attach(adapterMount);
    const adapterPreview = adapter.previewAnimations();
    animations.calls.at(-1).animation.finish();
    check('挂载后的 adapter 复用同一预览状态机', await adapterPreview);
    adapter.dispose();
  } finally {
    animations.restore();
  }
}
