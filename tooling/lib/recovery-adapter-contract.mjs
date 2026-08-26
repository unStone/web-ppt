import { createMemoryRecoveryStore } from './recovery-memory-store.mjs';

/** Adapter 只映射恢复生命周期；并发、取消和错误不能泄漏到其它文档代际。 */
export async function runRecoveryAdapterContract({ lib, load, check }) {
  console.log('\n\x1b[36m▸ 恢复 adapter 并发与错误隔离\x1b[0m');
  const source = load('sample-edit-xfrm.pptx');
  const expected = (await lib.fingerprintSource(source)).fingerprint;
  const { records, store } = createMemoryRecoveryStore();
  const seed = await lib.openEditor(source, {
    recovery: { store, decide: () => 'restore' },
  });
  const seedSlide = seed.editor.doc.slideOrder[0];
  const seedElement = seed.editor.doc.slides[seedSlide].children[0];
  const seedX = seed.editor.effectiveElement(seedElement).x + 41;
  seed.editor.exec({ type: 'SetXfrm', id: seedElement, x: seedX });
  await seed.recovery.flush();
  seed.dispose();

  const statuses = [];
  const phases = [];
  let candidate;
  let prompts = 0;
  const adapter = lib.createWebPptAdapter({
    onRecovery: (value) => { prompts++; candidate = value; return 'restore'; },
    onProgress: (progress) => phases.push(progress.phase),
  });
  adapter.subscribe((snapshot) => statuses.push(snapshot.status));
  const mount = document.createElement('div');
  adapter.attach(mount);
  const adapterSession = await adapter.setDocument({
    source, openOptions: { recovery: { store, decide: () => 'discard' } },
  });
  check('adapter 在挂载前发布 recovering 候选并由 onRecovery 覆盖底层 fallback',
    prompts === 1 && candidate.frameCount === 1
      && statuses.includes('recovering') && phases.includes('recovering')
      && adapter.snapshot.status === 'ready' && adapter.snapshot.recovery === null
      && adapterSession.editor.effectiveElement(seedElement).x === seedX
      && mount.querySelectorAll('[data-web-ppt-editor]').length === 1);
  adapter.dispose();

  let cancelErrors = 0;
  const cancelAdapter = lib.createWebPptAdapter({
    onRecovery: () => 'cancel', onError: () => { cancelErrors++; },
  });
  const cancelMount = document.createElement('div');
  cancelAdapter.attach(cancelMount);
  const cancelledSession = await cancelAdapter.setDocument({
    source, openOptions: { recovery: { store, decide: () => 'restore' } },
  });
  check('adapter 取消恢复回到 idle，不挂载、不报错且保留日志',
    cancelledSession === null && cancelAdapter.snapshot.status === 'idle'
      && cancelAdapter.snapshot.recovery === null && cancelErrors === 0
      && cancelMount.childElementCount === 0 && records.has(expected));
  cancelAdapter.dispose();

  const hostAbort = new AbortController();
  hostAbort.abort(new Error('宿主取消打开'));
  let hostAbortErrors = 0;
  const hostAbortAdapter = lib.createWebPptAdapter({ onError: () => { hostAbortErrors++; } });
  const hostAbortResult = await hostAbortAdapter.setDocument({
    source, openOptions: { recovery: { store, signal: hostAbort.signal } },
  });
  check('adapter 组合并透传宿主 AbortSignal，已取消的打开不会进入 ready 或报错',
    hostAbortResult === null && hostAbortAdapter.snapshot.status === 'idle'
      && hostAbortErrors === 0);
  hostAbortAdapter.dispose();

  let retryLoads = 0;
  let releaseRetryLoad;
  let reportRetryLoad;
  const retryLoadStarted = new Promise((resolve) => { reportRetryLoad = resolve; });
  const retryLoadGate = new Promise((resolve) => { releaseRetryLoad = resolve; });
  const retryRecords = new Map();
  const retryStore = {
    async load(identity) {
      retryLoads++;
      if (retryLoads === 1) { reportRetryLoad(); await retryLoadGate; }
      return structuredClone(retryRecords.get(identity.fingerprint) ?? null);
    },
    async reset(request) {
      if (request.signal?.aborted) throw request.signal.reason;
      const time = Date.now();
      retryRecords.set(request.source.fingerprint, {
        version: 1, source: structuredClone(request.source), idPrefix: request.idPrefix,
        epoch: request.epoch, createdAt: time, updatedAt: time, estimatedBytes: 0, frames: [],
      });
    },
    async append() {},
    async remove(identity) { retryRecords.delete(identity.fingerprint); },
  };
  const retryAdapter = lib.createWebPptAdapter();
  const retryAbort = new AbortController();
  const cancelledRetry = retryAdapter.setDocument({
    source, openOptions: { recovery: { store: retryStore, signal: retryAbort.signal } },
  });
  await retryLoadStarted;
  retryAbort.abort(new Error('换新信号重试'));
  const retriedOpen = retryAdapter.setDocument({
    source,
    openOptions: { recovery: { store: retryStore, signal: new AbortController().signal } },
  });
  releaseRetryLoad();
  const [cancelledRetryResult, retriedResult] = await Promise.all([cancelledRetry, retriedOpen]);
  check('进行中的宿主取消后换新 signal 会真正重试，不复用旧取消 Promise',
    cancelledRetryResult === null && retriedResult === retryAdapter.snapshot.session
      && retryLoads === 2 && retryAdapter.snapshot.status === 'ready');
  retryAdapter.dispose();

  let releaseLateDecision;
  const lateDecision = new Promise((resolve) => { releaseLateDecision = resolve; });
  const lateAbort = new AbortController();
  const lateAdapter = lib.createWebPptAdapter({ onRecovery: () => lateDecision });
  const lateOpen = lateAdapter.setDocument({
    source, openOptions: { recovery: { store, signal: lateAbort.signal } },
  });
  for (let attempt = 0; attempt < 100 && lateAdapter.snapshot.status !== 'recovering'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  lateAbort.abort(new Error('恢复决策期间取消'));
  const lateResult = await lateOpen;
  releaseLateDecision('restore');
  await Promise.resolve();
  await Promise.resolve();
  check('恢复决策被宿主取消后，迟到 resolve 不会把 idle 状态改回 opening',
    lateResult === null && lateAdapter.snapshot.status === 'idle'
      && lateAdapter.snapshot.session === null);
  lateAdapter.dispose();

  let resolveStaleDecision;
  const staleDecision = new Promise((resolve) => { resolveStaleDecision = resolve; });
  const staleStatuses = [];
  const staleAdapter = lib.createWebPptAdapter({ onRecovery: () => staleDecision });
  staleAdapter.subscribe((snapshot) => staleStatuses.push(snapshot.status));
  const staleMount = document.createElement('div');
  staleAdapter.attach(staleMount);
  const staleOpen = staleAdapter.setDocument({ source, openOptions: { recovery: { store } } });
  for (let attempt = 0; attempt < 100 && staleAdapter.snapshot.status !== 'recovering'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  const latestOpen = staleAdapter.setDocument({ source: load('sample-editor-notes.pptx') });
  resolveStaleDecision('restore');
  const [staleResult, latestResult] = await Promise.all([staleOpen, latestOpen]);
  check('恢复提示期间换文件会取消旧决策且只提交最新会话',
    staleStatuses.includes('recovering') && staleResult === null
      && latestResult === staleAdapter.snapshot.session
      && latestResult.editor.doc.slideOrder.length === 4
      && staleMount.querySelectorAll('[data-web-ppt-editor]').length === 1
      && records.has(expected));
  staleAdapter.dispose();

  const raceRecords = new Map();
  let resetCount = 0;
  let releaseFirstReset;
  let reportFirstReset;
  const firstReset = new Promise((resolve) => { reportFirstReset = resolve; });
  const resetGate = new Promise((resolve) => { releaseFirstReset = resolve; });
  const raceStore = {
    async load(identity) { return structuredClone(raceRecords.get(identity.fingerprint) ?? null); },
    async reset(request) {
      resetCount++;
      if (resetCount === 1) { reportFirstReset(); await resetGate; }
      if (request.signal?.aborted) throw request.signal.reason;
      const time = Date.now();
      raceRecords.set(request.source.fingerprint, {
        version: 1, source: structuredClone(request.source), idPrefix: request.idPrefix,
        epoch: request.epoch, createdAt: time, updatedAt: time, estimatedBytes: 0, frames: [],
      });
    },
    async append(request) {
      const current = raceRecords.get(request.source.fingerprint);
      if (!current || current.epoch !== request.epoch) throw new Error('恢复日志代际冲突');
    },
    async remove(identity) { raceRecords.delete(identity.fingerprint); },
  };
  const raceAdapter = lib.createWebPptAdapter();
  const raceMount = document.createElement('div');
  raceAdapter.attach(raceMount);
  const olderOpen = raceAdapter.setDocument({
    source: source.slice().buffer, openOptions: { recovery: { store: raceStore } },
  });
  await firstReset;
  const newestOpen = raceAdapter.setDocument({
    source: source.slice().buffer, openOptions: { recovery: { store: raceStore } },
  });
  releaseFirstReset();
  const [olderResult, newestResult] = await Promise.all([olderOpen, newestOpen]);
  const raceRecord = raceRecords.get(expected);
  check('同内容并发打开取消旧占位，迟到 reset 不会覆盖最新会话代际',
    olderResult === null && newestResult === raceAdapter.snapshot.session
      && resetCount === 2 && raceRecord.idPrefix === newestResult.editor.doc.identity.prefix
      && raceMount.querySelectorAll('[data-web-ppt-editor]').length === 1);
  raceAdapter.dispose();

  const diskError = new Error('模拟 quota 失败');
  let adapterErrors = 0;
  const failingStore = {
    async load() { return null; }, async reset() {},
    async append() { throw diskError; }, async remove() {},
  };
  const failingAdapter = lib.createWebPptAdapter({
    onError: (error) => { if (error === diskError) adapterErrors++; },
  });
  const failingSession = await failingAdapter.setDocument({
    source, openOptions: { recovery: { store: failingStore } },
  });
  const failingSlide = failingSession.editor.doc.slideOrder[0];
  const failingElement = failingSession.editor.doc.slides[failingSlide].children[0];
  failingSession.editor.exec({
    type: 'SetXfrm', id: failingElement,
    x: failingSession.editor.effectiveElement(failingElement).x + 1,
  });
  try { await failingSession.recovery.flush(); } catch { /* 由公共状态断言。 */ }
  check('adapter 报告自动保存失败但保持可编辑 ready 会话',
    adapterErrors === 1 && failingAdapter.snapshot.status === 'ready'
      && failingSession.recovery.error === diskError && failingSession.editor.isDirty());
  failingAdapter.dispose();

  let releaseDelayedAppend;
  let reportDelayedAppend;
  const delayedStarted = new Promise((resolve) => { reportDelayedAppend = resolve; });
  const delayedGate = new Promise((resolve) => { releaseDelayedAppend = resolve; });
  const delayedStore = {
    async load() { return null; }, async reset() {},
    async append() { reportDelayedAppend(); await delayedGate; throw diskError; },
    async remove() {},
  };
  let staleErrors = 0;
  const delayedAdapter = lib.createWebPptAdapter({ onError: () => { staleErrors++; } });
  const delayedSession = await delayedAdapter.setDocument({
    source, openOptions: { recovery: { store: delayedStore } },
  });
  const delayedSlide = delayedSession.editor.doc.slideOrder[0];
  const delayedElement = delayedSession.editor.doc.slides[delayedSlide].children[0];
  delayedSession.editor.exec({
    type: 'SetXfrm', id: delayedElement,
    x: delayedSession.editor.effectiveElement(delayedElement).x + 1,
  });
  await delayedStarted;
  const replacement = await delayedAdapter.setDocument({
    source: load('sample-editor-notes.pptx'),
  });
  releaseDelayedAppend();
  try { await delayedSession.recovery.flush(); } catch { /* 旧会话仍保留自身错误。 */ }
  check('旧会话迟到的持久化失败不会污染替换后的 adapter',
    staleErrors === 0 && delayedAdapter.snapshot.status === 'ready'
      && delayedAdapter.snapshot.session === replacement
      && delayedSession.disposed && delayedSession.recovery.error === diskError);
  delayedAdapter.dispose();
}
