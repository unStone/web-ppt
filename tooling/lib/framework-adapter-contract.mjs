import { keyboardEvent } from './keyboard-event.mjs';

/** 框架无关控制器守住文件替换、所有权、并发打开与多视图的唯一实现。 */
export async function runFrameworkAdapterContract({ lib, load, check }) {
  console.log('\n\x1b[36m▸ 框架无关 adapter 生命周期\x1b[0m');
  if (!check('发布入口公开框架无关 adapter 工厂',
    typeof lib.createWebPptAdapter === 'function')) return;

  const events = { ready: [], progress: [], changes: [], views: [], errors: [] };
  const adapter = lib.createWebPptAdapter({
    onReady: (session) => events.ready.push(session),
    onProgress: (progress) => events.progress.push(progress),
    onChange: (change) => events.changes.push(change),
    onViewChange: (view) => events.views.push(view),
    onError: (error) => events.errors.push(error),
  });
  let snapshots = 0;
  const readyKinds = [];
  const unsubscribeSnapshot = adapter.subscribe((snapshot) => {
    snapshots++;
    if (snapshot.status === 'ready') {
      readyKinds.push([snapshot.documentKind, snapshot.session?.editor.doc.meta.source ?? null]);
    }
  });
  const mount = document.createElement('div');
  adapter.attach(mount);
  adapter.setView({ mode: 'view', zoom: 1.25, textMode: 'svg', snapping: false });
  const first = await adapter.setDocument({
    source: load('sample-edit-xfrm.pptx'), openOptions: { idPrefix: 'adapter-first-' },
  });
  check('来源文件由 adapter 打开、挂载并显式拥有资源',
    adapter.snapshot.status === 'ready' && adapter.snapshot.session === first
      && adapter.snapshot.documentKind === 'pptx'
      && adapter.snapshot.view?.mode === 'view' && adapter.snapshot.view.zoom === 1.25
      && adapter.snapshot.view.snapping === false
      && mount.querySelectorAll('[data-web-ppt-editor]').length === 1
      && readyKinds.every(([kind, source]) => kind === source)
      && events.progress[0]?.phase === 'opening' && events.progress.at(-1)?.phase === 'ready'
      && events.ready.at(-1) === first && events.errors.length === 0);
  check('查看模式与控制器受控模式共用只读编辑视图',
    adapter.snapshot.view.setNotes('不能写') === false && !first.editor.isDirty());
  const snapshotsBeforeNoop = snapshots;
  adapter.setView({ mode: 'view', zoom: 1.25, textMode: 'svg', snapping: false });
  check('相同受控属性不制造订阅更新', snapshots === snapshotsBeforeNoop);

  const legacyAdapter = lib.createWebPptAdapter();
  const legacyMount = document.createElement('div');
  const legacyReadyKinds = [];
  legacyAdapter.subscribe((snapshot) => {
    if (snapshot.status === 'ready') {
      legacyReadyKinds.push([snapshot.documentKind, snapshot.session?.editor.doc.meta.source ?? null]);
    }
  });
  legacyAdapter.attach(legacyMount);
  const legacy = await legacyAdapter.setDocument({
    source: load('sample.ppt'), openOptions: { idPrefix: 'adapter-ppt-conversion-' },
  });
  const legacySaved = await legacyAdapter.save();
  check('adapter 公开输入格式且 .ppt 与 .pptx 共用生成保存 seam',
    legacyAdapter.snapshot.documentKind === 'ppt'
      && legacy.editor.doc.meta.readonly === false
      && legacyReadyKinds.length > 0
      && legacyReadyKinds.every(([kind, source]) => kind === source)
      && legacyMount.querySelectorAll('[data-edit-id]').length > 0
      && legacySaved[0] === 0x50 && legacySaved[1] === 0x4b);
  legacyAdapter.dispose();

  const recoverySource = load('sample-edit-xfrm.pptx');
  const recoverySeed = await lib.openEditor(recoverySource, { idPrefix: 'adapter-recovery-' });
  const recoveryFrames = [];
  const stopRecovery = recoverySeed.editor.subscribeRecovery((frame) => recoveryFrames.push(frame));
  const recoverySlide = recoverySeed.editor.doc.slideOrder[0];
  const recoveryElement = recoverySeed.editor.doc.slides[recoverySlide].children[0];
  const recoveryX = recoverySeed.editor.effectiveElement(recoveryElement).x + 19;
  recoverySeed.editor.exec({ type: 'SetXfrm', id: recoveryElement, x: recoveryX });
  stopRecovery();
  recoverySeed.dispose();
  const recoveryAdapter = lib.createWebPptAdapter();
  recoveryAdapter.attach(document.createElement('div'));
  const unrecoveredSession = await recoveryAdapter.setDocument({
    source: recoverySource, openOptions: { idPrefix: 'adapter-recovery-' },
  });
  const recoveredSession = await recoveryAdapter.setDocument({
    source: recoverySource,
    openOptions: { idPrefix: 'adapter-recovery-', recoveryFrames },
  });
  check('同源文件新增恢复日志时 adapter 重开并在挂载前恢复',
    recoveredSession !== unrecoveredSession && unrecoveredSession.disposed
      && recoveredSession.editor.effectiveElement(recoveryElement).x === recoveryX);
  recoveryAdapter.dispose();

  adapter.setView({ mode: 'edit', zoom: 0.75 });
  const slideId = first.editor.doc.slideOrder[0];
  const elementId = first.editor.doc.slides[slideId].children[0];
  first.editor.exec({
    type: 'SetXfrm', id: elementId, x: first.editor.doc.elements[elementId].src.x + 7,
  });
  const saved = await adapter.save();
  check('模式、缩放、编辑订阅、撤销与保存通过同一控制器暴露',
    adapter.snapshot.view.mode === 'edit' && adapter.snapshot.view.zoom === 0.75
      && events.changes.length === 1 && saved instanceof Uint8Array && saved.length > 0
      && !first.editor.isDirty() && adapter.undo() !== null && first.editor.isDirty());

  const firstPackage = first.editor.doc.package;
  const replacement = await adapter.setDocument({
    source: load('sample-editor-add-slide.pptx'), openOptions: { idPrefix: 'adapter-replace-' },
  });
  check('文件替换原子切换视图并释放前一个自有 session',
    replacement !== first && first.disposed && firstPackage.disposed
      && adapter.snapshot.session === replacement
      && mount.querySelectorAll('[data-web-ppt-editor]').length === 1);

  let openRejected = false;
  try { await adapter.setDocument({ source: new Uint8Array([0, 1, 2, 3]) }); } catch { openRejected = true; }
  check('新文件打开失败时保留原会话并发布可恢复错误',
    openRejected && adapter.snapshot.status === 'error' && adapter.snapshot.session === replacement
      && !replacement.disposed && events.errors.length === 1
      && mount.querySelectorAll('[data-web-ppt-editor]').length === 1);

  const slow = adapter.setDocument({
    source: load('showcase.pptx'), openOptions: { idPrefix: 'adapter-stale-' },
  });
  const latest = adapter.setDocument({
    source: load('sample-editor-notes.pptx'), openOptions: { idPrefix: 'adapter-latest-' },
  });
  const [staleResult, latestResult] = await Promise.all([slow, latest]);
  check('并发打开只提交最新请求，过期 session 在可见前即释放',
    staleResult === null && latestResult === adapter.snapshot.session
      && latestResult.editor.doc.slideOrder.length === 4
      && mount.querySelectorAll('[data-web-ppt-editor]').length === 1);
  const adapterFirstSlide = latestResult.editor.doc.slideOrder[0];
  const adapterSecondSlide = latestResult.editor.doc.slideOrder[1];
  const adapterPaneMount = document.createElement('div');
  adapter.attachSelectionPane(adapterPaneMount);
  adapter.snapshot.view.element.focus();
  const adapterPageDown = adapter.snapshot.view.element.dispatchEvent(
    keyboardEvent('keydown', 'PageDown'),
  );
  check('视图内部翻页同步 adapter snapshot、selection pane 与 onViewChange',
    !adapterPageDown && adapterFirstSlide !== adapterSecondSlide
      && adapter.snapshot.slideId === adapterSecondSlide
      && adapter.snapshot.selectionPane?.slideId === adapterSecondSlide
      && events.views.at(-1)?.slideId === adapterSecondSlide);

  const external = await lib.openEditor(load('sample-editor-notes.pptx'), {
    idPrefix: 'adapter-external-',
  });
  const editMount = document.createElement('div');
  const viewMount = document.createElement('div');
  let externalChanges = 0;
  const editAdapter = lib.createWebPptAdapter({ onChange: () => { externalChanges++; } });
  const viewAdapter = lib.createWebPptAdapter();
  editAdapter.attach(editMount);
  viewAdapter.attach(viewMount);
  await editAdapter.setDocument({ session: external, ownership: 'external' });
  await viewAdapter.setDocument({ session: external, ownership: 'external' });
  editAdapter.setView({ mode: 'edit' });
  viewAdapter.setView({ mode: 'view' });
  const sharedSlide = external.editor.doc.slideOrder[0];
  editAdapter.snapshot.view.setNotes('跨框架共享');
  check('显式 external 所有权允许两视图同步且只读边界不变',
    editAdapter.snapshot.view.queryNotes().value === '跨框架共享'
      && viewAdapter.snapshot.view.queryNotes().value === '跨框架共享'
      && viewAdapter.snapshot.view.setNotes('越权') === false);
  const observedBeforeDispose = externalChanges;
  editAdapter.dispose();
  viewAdapter.dispose();
  check('适配器卸载只销毁自己的视图，不双重释放外部 session',
    !external.disposed && editMount.childElementCount === 0 && viewMount.childElementCount === 0);
  external.editor.exec({ type: 'SetNotes', id: sharedSlide, text: '退订后' });
  check('销毁后不再接收编辑事件', externalChanges === observedBeforeDispose);

  const returnMount = document.createElement('div');
  const returnErrors = [];
  const returnAdapter = lib.createWebPptAdapter({ onError: (error) => returnErrors.push(error) });
  returnAdapter.attach(returnMount);
  await returnAdapter.setDocument({ session: external, ownership: 'external' });
  const staleOpen = returnAdapter.setDocument({
    source: load('showcase.pptx'), openOptions: { idPrefix: 'adapter-return-stale-' },
  });
  const restored = await returnAdapter.setDocument({ session: external, ownership: 'external' });
  const staleReturn = await staleOpen;
  check('取消 source 打开并切回同一外部 session 会恢复 ready',
    staleReturn === null && restored === external && returnAdapter.snapshot.status === 'ready'
      && returnAdapter.snapshot.session === external && returnAdapter.snapshot.view !== null);
  try { await returnAdapter.setDocument({ source: new Uint8Array([4, 3, 2, 1]) }); } catch { /* 预期 */ }
  await returnAdapter.setDocument({ session: external, ownership: 'external' });
  check('打开失败后切回同一外部 session 会清除 error',
    returnAdapter.snapshot.status === 'ready' && returnAdapter.snapshot.error === null
      && returnErrors.length === 1);
  returnAdapter.dispose();

  const invalid = lib.createWebPptAdapter();
  let rejected = false;
  try { await invalid.setDocument({ session: external }); } catch { rejected = true; }
  check('注入 session 必须声明 external 所有权', rejected && !external.disposed);
  invalid.dispose();

  const bindingErrors = [];
  const bindingAdapter = lib.createWebPptAdapter({ onError: (error) => bindingErrors.push(error) });
  let invalidBindingRejected = false;
  try {
    await lib.applyWebPptAdapterBinding(bindingAdapter, {
      source: load('sample-edit-xfrm.pptx'), session: external, sessionOwnership: 'external',
    });
  } catch { invalidBindingRejected = true; }
  check('非法 binding 统一进入 error snapshot 与 onError',
    invalidBindingRejected && bindingAdapter.snapshot.status === 'error'
      && bindingErrors.length === 1);
  await lib.applyWebPptAdapterBinding(bindingAdapter, {
    session: external, sessionOwnership: 'external', mode: 'edit', zoom: 1,
  });
  let zoomSyncThrew = false;
  let zoomRejected = false;
  let zoomResult;
  try {
    zoomResult = lib.applyWebPptAdapterBinding(bindingAdapter, {
      session: external, sessionOwnership: 'external', mode: 'edit', zoom: 0,
    });
  } catch { zoomSyncThrew = true; }
  try { await zoomResult; } catch { zoomRejected = true; }
  check('受控属性错误以异步 rejection 和 error 事件报告',
    !zoomSyncThrew && zoomRejected && bindingAdapter.snapshot.status === 'error'
      && bindingErrors.length === 2 && bindingAdapter.snapshot.zoom === 1);
  bindingAdapter.dispose();

  let callbackErrors = 0;
  let readyCallbacks = 0;
  const isolationAdapter = lib.createWebPptAdapter({
    onReady: () => { readyCallbacks++; throw new Error('ready 回调失败'); },
    onError: () => { callbackErrors++; throw new Error('error 回调失败'); },
  });
  isolationAdapter.subscribe(() => { throw new Error('订阅者失败'); });
  let isolationRejected = false;
  let isolationCommitted = false;
  try {
    const isolatedSession = await isolationAdapter.setDocument({
      source: load('sample-edit-xfrm.pptx'), openOptions: { idPrefix: 'adapter-isolation-' },
    });
    isolationCommitted = isolatedSession !== null && isolationAdapter.snapshot.status === 'ready';
  } catch { isolationRejected = true; }
  let isolationDisposeThrew = false;
  try { isolationAdapter.dispose(); } catch { isolationDisposeThrew = true; }
  check('订阅者、ready 与 error 回调异常不破坏会话提交和幂等销毁',
    !isolationRejected && isolationCommitted && !isolationDisposeThrew
      && readyCallbacks === 1 && callbackErrors > 0
      && isolationAdapter.snapshot.status === 'disposed');
  external.dispose();

  const finalSession = adapter.snapshot.session;
  const finalPackage = finalSession.editor.doc.package;
  adapter.dispose();
  adapter.dispose();
  unsubscribeSnapshot();
  check('自有 adapter 销毁幂等并释放最终 session、DOM 与包资源',
    adapter.snapshot.status === 'disposed' && finalSession.disposed && finalPackage.disposed
      && mount.childElementCount === 0);

}
