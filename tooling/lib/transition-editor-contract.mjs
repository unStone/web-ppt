function installAnimations(window) {
  const active = new Map();
  const calls = [];
  const originalAnimate = window.HTMLElement.prototype.animate;
  const originalGetAnimations = window.HTMLElement.prototype.getAnimations;
  let failOwner = null;
  window.HTMLElement.prototype.animate = function animate(frames, options) {
    if (this === failOwner) {
      failOwner = null;
      throw new Error('mock animate failure');
    }
    let resolve;
    let reject;
    const finished = new Promise((res, rej) => { resolve = res; reject = rej; });
    const animation = {
      finished, cancelled: false, completed: false,
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
      owner: this,
    };
    const owned = active.get(this) ?? new Set();
    owned.add(animation);
    active.set(this, owned);
    calls.push({ owner: this, frames, options, animation });
    return animation;
  };
  window.HTMLElement.prototype.getAnimations = function getAnimations() {
    return [...(active.get(this) ?? [])];
  };
  return {
    calls,
    failNext(owner) { failOwner = owner; },
    restore() {
      window.HTMLElement.prototype.animate = originalAnimate;
      if (originalGetAnimations) window.HTMLElement.prototype.getAnimations = originalGetAnimations;
      else delete window.HTMLElement.prototype.getAnimations;
    },
  };
}

/** 编辑器与 adapter 只复用 viewer-core 播放层，不建立产品面板状态。 */
export async function runTransitionEditorContract({ lib, viewer, load, check, window }) {
  console.log('\n\x1b[36m▸ 页面切换 view/edit 即时预览\x1b[0m');
  const animations = installAnimations(window);
  try {
    const session = await lib.openEditor(load('sample-editor-transitions.pptx'), {
      idPrefix: 'transition-editor-',
    });
    const container = document.createElement('div');
    const fade = session.editor.doc.slideOrder[1];
    const otherContainer = document.createElement('div');
    const view = session.mount(container, { slideId: fade, mode: 'view' });
    const other = session.mount(otherContainer, { slideId: fade, mode: 'edit' });
    const history = session.editor.history.undoCount;
    const selection = JSON.stringify(session.editor.selection);
    check('默认挂载不创建切换控制器动画且查询直接读取有效模型',
      animations.calls.length === 0 && view.queryTransition().value.type === 'fade'
        && view.transitionPreview === null
        && !view.queryTransition().direct
        && !container.querySelector('[data-ppt-transition-preview]'));
    check('查看模式可预览但不能修改', view.setTransition({ type: 'push', dir: 'l' }) === false
      && !session.editor.isDirty());

    const first = view.previewTransition();
    check('当前有效切换通过静态高保真层和真实时长播放',
      animations.calls.length === 2
        && view.transitionPreview !== null
        && animations.calls[0].owner === container.querySelector('[data-ppt-layer="static"]')
        && animations.calls[0].options.duration === view.queryTransition().value.durationMs
        && !!container.querySelector('[data-ppt-transition-preview]'));
    const second = view.previewTransition({ type: 'push', dir: 'r', durationMs: 500 });
    check('连续预览取消旧动画并使用尚未提交的合法值',
      animations.calls.length === 4 && animations.calls[0].animation.cancelled
        && animations.calls[1].animation.cancelled
        && animations.calls[2].options.duration === 500
        && animations.calls[2].frames[0].transform === 'translate(100%, 0)');
    animations.calls[2].animation.finish();
    animations.calls[3].animation.finish();
    check('预览不改变模型、选区或历史', await first && await second
      && session.editor.history.undoCount === history
      && JSON.stringify(session.editor.selection) === selection
      && !session.editor.isDirty());
    check('none 和无来源页给出明确未播放结果',
      await view.previewTransition({ type: 'none' }) === false);

    view.setMode('edit');
    check('编辑模式通过同一 seam 提交并让另一 view 立即查询到结果',
      view.setTransition({ type: 'morph', durationMs: 900, morphBy: 'byWord' })
        && other.queryTransition().value.type === 'morph'
        && other.queryTransition().value.morphBy === 'byWord');
    check('恢复来源同样使用当前稳定页身份', view.setTransition(null)
      && other.queryTransition().value.type === 'fade' && !other.queryTransition().direct);

    const pending = other.previewTransition({ type: 'wipe', dir: 'd', durationMs: 700 });
    const pendingCalls = animations.calls.slice(-2);
    other.destroy();
    check('销毁视图会取消未完成预览',
      pendingCalls.every((call) => call.animation.cancelled) && await pending);
    view.destroy();
    session.dispose();

    const adapter = lib.createWebPptAdapter();
    const mount = document.createElement('div');
    await adapter.setDocument({
      source: load('sample-editor-transitions.pptx'),
      openOptions: { idPrefix: 'transition-adapter-' },
    });
    adapter.setView({ slideId: adapter.snapshot.session.editor.doc.slideOrder[1], mode: 'edit' });
    check('无 DOM 挂载的 ready adapter 仍可查询和编辑模型',
      adapter.queryTransition().value.type === 'fade'
        && adapter.setTransition({ type: 'cut', durationMs: 320 })
        && adapter.queryTransition().value.type === 'cut');
    adapter.setView({ mode: 'view' });
    check('无 DOM 的查看模式权限不依赖视图实例',
      adapter.setTransition({ type: 'push', dir: 'l' }) === false
        && await adapter.previewTransition() === false);
    adapter.setView({ mode: 'edit' });
    adapter.setTransition(null);
    adapter.setView({ mode: 'view' });
    adapter.attach(mount);
    check('框架 adapter 公开同一查询与查看权限边界',
      adapter.queryTransition().value.type === 'fade'
        && adapter.setTransition({ type: 'cut' }) === false);
    const adapterPreview = adapter.previewTransition({ type: 'cut', durationMs: 300 });
    const adapterCalls = animations.calls.slice(-2);
    check('cut 预览的出场层在切点前后确有视觉变化',
      adapterCalls[1].frames[0].opacity === 1 && adapterCalls[1].frames.at(-1).opacity === 0);
    adapterCalls.forEach((call) => call.animation.finish());
    adapter.setView({ mode: 'edit' });
    check('adapter 预览和编辑动作无需 React/Vue 复制状态机',
      await adapterPreview && adapter.setTransition({ type: 'cut', durationMs: 300 })
        && adapter.queryTransition().value.type === 'cut');
    adapter.dispose();

    const failedIncoming = document.createElement('div');
    const failedOutgoing = document.createElement('div');
    document.body.append(failedOutgoing, failedIncoming);
    animations.failNext(failedOutgoing);
    const failed = viewer.playTransitionControlled(
      failedOutgoing, failedIncoming, { type: 'fade', durationMs: 80 },
    );
    const firstLayer = animations.calls.at(-1)?.animation;
    await failed.finished;
    check('出场层 animate 抛错时同步回收已创建的入场动画',
      firstLayer?.cancelled && !failedOutgoing.isConnected);
    failedIncoming.remove();
  } finally {
    animations.restore();
  }
}
