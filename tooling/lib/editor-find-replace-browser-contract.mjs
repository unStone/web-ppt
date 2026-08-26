const p95 = (samples) => [...samples].sort((left, right) => left - right)
  [Math.floor(samples.length * 0.95)];

/** 会话控制器在真实浏览器中共享单一状态；首个切片不依赖任何产品搜索栏。 */
export async function runEditorFindReplaceBrowserContract({ openEditor, createWebPptAdapter, load }) {
  const session = await openEditor(await load('sample-editor-find-replace.pptx'), {
    idPrefix: 'browser-find-replace-',
  });
  const search = session.textSearch;
  const selectedId = session.editor.doc.slides[session.editor.doc.slideOrder[0]].children[0];
  session.editor.select({ kind: 'elements', ids: [selectedId], enteredGroup: null });
  const selectionBeforeSearch = JSON.stringify(session.editor.selection);
  search.open({
    mode: 'find', query: 'NEEDLE', scope: { kind: 'document' },
    matchCase: false, wholeWord: true,
  });
  const initial = search.snapshot;
  const first = initial.current;
  const second = search.next();
  for (let index = 0; index < initial.matches.length - 1; index++) search.next();
  const wrapped = search.snapshot.current;
  const previous = search.previous();
  if (!initial.open || initial.matches.length !== 6 || initial.currentIndex !== 0
    || !first || second?.key === first.key || wrapped?.key !== first.key
    || previous?.key !== initial.matches[initial.matches.length - 1].key) {
    throw new Error('会话查找没有建立稳定结果或前后循环导航');
  }
  let invalidOpenRejected = false;
  try {
    search.open({ mode: 'replace', query: 'Needle', matchCase: 'invalid' });
  } catch { invalidOpenRejected = true; }
  search.setReplacement('strict-probe');
  if (!invalidOpenRejected || search.snapshot.mode !== 'find'
    || search.snapshot.query !== 'NEEDLE' || search.snapshot.matchCase !== false) {
    throw new Error('非法会话选项在拒绝前部分修改了查找状态');
  }

  const current = search.snapshot.current;
  session.editor.exec({
    type: 'ReplaceText', from: 'NEEDLE', to: '已改', matchCase: false, wholeWord: true,
    scope: {
      kind: 'match', match: {
        slideId: current.slideId, id: current.id,
        ...(current.cell ? { cell: current.cell } : {}), range: current.range,
      },
    },
  });
  if (search.snapshot.matches.length !== 5 || search.snapshot.current?.key === current.key
    || !search.snapshot.currentInvalidated
    || JSON.stringify(session.editor.selection) !== selectionBeforeSearch) {
    throw new Error('文档事务后会话查找没有增量重查或仍指向失效命中');
  }
  const hiddenGroup = Object.values(session.editor.doc.elements)
    .find((record) => record.src.name === 'find-group');
  session.editor.exec({ type: 'SetElementHidden', id: hiddenGroup.id, hidden: true });
  if (search.snapshot.matches.length !== 4
    || search.snapshot.matches.some((match) => match.id === hiddenGroup.id)
    || JSON.stringify(session.editor.selection) !== selectionBeforeSearch) {
    throw new Error('隐藏组没有增量退出可见文字索引，或后台重扫破坏了普通选区');
  }
  session.editor.undo();
  if (search.snapshot.matches.length !== 5) throw new Error('恢复可见性后查找索引没有恢复命中');
  session.dispose();
  let disposedRejected = false;
  try { search.open({ mode: 'find' }); } catch { disposedRejected = true; }
  if (!search.disposed || !disposedRejected) throw new Error('会话销毁没有封闭查找控制器重入');

  const firstMount = document.createElement('div');
  const secondMount = document.createElement('div');
  firstMount.className = secondMount.className = 'contract-offscreen';
  document.body.append(firstMount, secondMount);
  const viewSession = await openEditor(await load('sample-editor-find-replace.pptx'), {
    idPrefix: 'browser-find-view-',
  });
  const firstSlide = viewSession.editor.doc.slideOrder[0];
  const firstView = viewSession.mount(firstMount, { mode: 'view', slideId: firstSlide, textMode: 'html' });
  const secondView = viewSession.mount(secondMount, { mode: 'edit', slideId: firstSlide, textMode: 'svg' });
  firstView.openTextSearch({
    mode: 'find', query: 'Needle', scope: { kind: 'document' }, matchCase: false, wholeWord: true,
  });
  const currentId = viewSession.textSearch.snapshot.current.id;
  const currentRoot = [...firstMount.querySelectorAll('[data-edit-root]')]
    .find((element) => element.dataset.editRoot === currentId);
  if (firstView.element.dataset.textSearch !== 'find'
    || secondView.element.dataset.textSearch !== 'find'
    || firstView.element.dataset.textSearchReplaceDisabled !== 'true'
    || !currentRoot?.hasAttribute('data-ppt-search-current')
    || firstMount.querySelectorAll('[data-ppt-layer]').length !== 3
    || firstMount.querySelector('[data-ppt-search-overlay]')?.hidden
    || firstMount.querySelector('[data-ppt-search-overlay]')?.dataset.pptSearchExact !== 'true'
    || !firstMount.querySelector('[data-ppt-search-current-range]')) {
    throw new Error('查看模式查找没有共享状态、数据属性或可见高亮');
  }
  for (let index = 0; index < 4; index++) firstView.nextTextSearch();
  const firstRange = [...firstMount.querySelectorAll('[data-ppt-search-range]')]
    .map((element) => element.getAttribute('style')).join('|');
  const countObserver = new MutationObserver(() => {});
  countObserver.observe(firstView.element, {
    subtree: true, attributes: true, attributeFilter: ['data-ppt-search-matches'],
  });
  firstView.nextTextSearch();
  const secondRange = [...firstMount.querySelectorAll('[data-ppt-search-range]')]
    .map((element) => element.getAttribute('style')).join('|');
  const countMutations = countObserver.takeRecords();
  countObserver.disconnect();
  const viewReplaceBlocked = firstView.replaceCurrentText() === false;
  if (firstView.slideId !== viewSession.editor.doc.slideOrder[1]
    || secondView.slideId !== firstSlide
    || firstRange === secondRange || !firstRange || !secondRange
    || countMutations.length !== 0 || !viewReplaceBlocked) {
    throw new Error(`跨页导航、精确命中、增量标记或查看模式权限不符合契约：${JSON.stringify({
      firstSlide: firstView.slideId,
      expected: viewSession.editor.doc.slideOrder[1],
      secondSlide: secondView.slideId,
      firstRange, secondRange, countMutations: countMutations.length, viewReplaceBlocked,
    })}`);
  }

  firstView.closeTextSearch();
  firstView.element.focus();
  const key = (value, init = {}) => firstView.element.dispatchEvent(new KeyboardEvent('keydown', {
    key: value, bubbles: true, cancelable: true, ...init,
  }));
  key('f', { ctrlKey: true });
  if (!viewSession.textSearch.snapshot.open || viewSession.textSearch.snapshot.mode !== 'find') {
    throw new Error('Ctrl/Cmd+F 没有打开会话查找');
  }
  key('h', { ctrlKey: true });
  if (viewSession.textSearch.snapshot.mode !== 'replace') throw new Error('Ctrl/Cmd+H 没有打开替换状态');
  const beforeEnter = viewSession.textSearch.snapshot.current?.key;
  key('Enter');
  if (viewSession.textSearch.snapshot.current?.key === beforeEnter) throw new Error('Enter 没有导航下一命中');
  key('Escape');
  if (viewSession.textSearch.snapshot.open) throw new Error('Escape 没有关闭查找状态');
  firstView.destroy();
  secondView.destroy();
  viewSession.dispose();
  firstMount.remove();
  secondMount.remove();

  const adapterSession = await openEditor(await load('sample-editor-find-replace.pptx'), {
    idPrefix: 'browser-find-adapter-',
  });
  const adapterMount = document.createElement('div');
  adapterMount.className = 'contract-offscreen';
  document.body.append(adapterMount);
  const adapter = createWebPptAdapter();
  await adapter.setDocument({ session: adapterSession, ownership: 'external' });
  adapter.attach(adapterMount);
  adapter.setView({ mode: 'view' });
  adapter.openTextSearch({
    mode: 'replace', query: 'NEEDLE', replacement: 'adapter',
    scope: { kind: 'document' }, matchCase: false, wholeWord: true,
  });
  const viewState = adapter.snapshot.textSearch;
  const viewText = viewState.current?.text;
  const viewReplace = adapter.replaceCurrentText();
  for (let index = 0; index < 4; index++) adapter.nextTextSearch();
  const adapterCrossPage = adapter.snapshot.slideId === adapterSession.editor.doc.slideOrder[1]
    && adapter.snapshot.view?.slideId === adapterSession.editor.doc.slideOrder[1];
  adapter.previousTextSearch();
  if (!viewState.open || viewState.matches.length !== 6 || viewState.canReplace
    || viewReplace || !adapterCrossPage
    || adapterSession.textSearch.snapshot.matches[0]?.text !== viewText) {
    throw new Error('adapter 没有共享查看态查找、跨页联动或正确限制替换权限');
  }
  adapter.setView({ mode: 'edit' });
  adapter.setTextSearchReplacement('adapter');
  if (!adapter.snapshot.textSearch.canReplace || !adapter.replaceCurrentText()
    || adapter.snapshot.textSearch.matches.length !== 5) {
    throw new Error('adapter 编辑态没有替换当前命中或同步状态');
  }
  adapter.setTextSearchQuery('NEEDLE');
  adapter.setTextSearchOptions({ matchCase: false, wholeWord: true });
  for (let index = 0; index < 3; index++) adapter.nextTextSearch();
  const beforeRepeatReplace = adapter.snapshot.slideId;
  adapter.setTextSearchReplacement('NEEDLE++');
  const repeatCount = adapter.replaceAllText();
  const repeatRevealed = beforeRepeatReplace === adapterSession.editor.doc.slideOrder[1]
    && adapter.snapshot.textSearch.matches.length === 5
    && adapter.snapshot.slideId === adapter.snapshot.textSearch.current?.slideId
    && adapter.snapshot.view?.slideId === adapter.snapshot.textSearch.current?.slideId;
  adapter.setTextSearchReplacement('adapter');
  if (repeatCount !== 5 || !repeatRevealed
    || adapter.replaceAllText() !== 5 || adapter.snapshot.textSearch.matches.length !== 0) {
    throw new Error('adapter 没有通过会话控制器执行一次全部替换');
  }
  adapter.closeTextSearch();
  if (adapter.snapshot.textSearch.open) throw new Error('adapter 没有关闭查找状态');
  let updates = 0;
  adapter.subscribe(() => { updates++; });
  adapter.dispose();
  const beforeDetachedMutation = updates;
  adapterSession.textSearch.open({ mode: 'find', query: 'adapter' });
  if (updates !== beforeDetachedMutation || adapterSession.disposed) {
    throw new Error('adapter 销毁后仍订阅外部会话，或错误释放外部会话');
  }
  adapterSession.dispose();
  adapterMount.remove();

  const perfMount = document.createElement('div');
  perfMount.className = 'contract-offscreen';
  document.body.append(perfMount);
  const perfSession = await openEditor(await load('sample-editor-60.pptx'), {
    idPrefix: 'browser-find-60-', historyLimit: 200,
  });
  const perfSlide = perfSession.editor.doc.slideOrder[0];
  const perfIds = perfSession.editor.doc.slides[perfSlide].children;
  perfSession.editor.transaction((transaction) => {
    for (const id of perfIds) transaction.exec({
      type: 'EditText', id,
      ops: [{
        type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 }, text: 'Needle',
      }],
    });
  }, '查找性能文字准备');
  perfSession.editor.history.clear();
  const perfView = perfSession.mount(perfMount, { slideId: perfSlide, mode: 'edit', textMode: 'svg' });
  perfView.openTextSearch({
    mode: 'replace', query: 'Needle', replacement: 'Changed',
    scope: { kind: 'slide', slideId: perfSlide }, matchCase: true, wholeWord: true,
  });
  const navigationSamples = [];
  for (let index = 0; index < 80; index++) {
    const started = performance.now();
    perfView.nextTextSearch();
    navigationSamples.push(performance.now() - started);
  }
  const replaceSamples = [];
  for (let index = 0; index < 40; index++) {
    const started = performance.now();
    if (!perfView.replaceCurrentText()) throw new Error('60 元素替换性能循环提前失去当前命中');
    replaceSamples.push(performance.now() - started);
    perfSession.editor.undo();
  }
  const navigationP95 = p95(navigationSamples);
  const replaceP95 = p95(replaceSamples);
  if (perfIds.length !== 60 || perfSession.textSearch.snapshot.matches.length !== 60
    || navigationP95 > 16 || replaceP95 > 16
    || perfMount.querySelectorAll('[data-ppt-search-matches]').length !== 60) {
    throw new Error(`60 元素查找导航/替换反馈 p95 ${navigationP95.toFixed(3)}/${replaceP95.toFixed(3)}ms`);
  }
  perfSession.dispose();
  perfMount.remove();

  const pagesSession = await openEditor(await load('sample-editor-find-replace.pptx'), {
    idPrefix: 'browser-find-200-', historyLimit: 500,
  });
  const duplicateSource = pagesSession.editor.doc.slideOrder[1];
  while (pagesSession.editor.doc.slideOrder.length < 200) {
    pagesSession.editor.exec({ type: 'DuplicateSlide', id: duplicateSource });
  }
  pagesSession.editor.history.clear();
  if (pagesSession.textSearch.snapshot.open || pagesSession.textSearch.snapshot.matches.length) {
    throw new Error('默认预览路径在没有查询时建立了可见搜索结果');
  }
  const buildStarted = performance.now();
  pagesSession.textSearch.open({
    mode: 'find', query: 'Needle', scope: { kind: 'document' }, matchCase: false, wholeWord: true,
  });
  const buildMs = performance.now() - buildStarted;
  pagesSession.textSearch.setReplacement('Indexed');
  const incrementalStarted = performance.now();
  pagesSession.textSearch.replaceCurrent();
  const incrementalMs = performance.now() - incrementalStarted;
  if (pagesSession.textSearch.snapshot.matches.length !== 399) {
    throw new Error('200 页单页失效后没有只更新受影响结果');
  }
  pagesSession.editor.undo();
  const querySamples = [];
  for (let index = 0; index < 45; index++) {
    const started = performance.now();
    pagesSession.textSearch.setQuery(`不存在-${index % 9}`);
    querySamples.push(performance.now() - started);
  }
  const queryP95 = p95(querySamples);
  if (pagesSession.editor.doc.slideOrder.length !== 200 || buildMs > 30
    || queryP95 > 30 || incrementalMs > 16) {
    throw new Error(`200 页索引/查询/增量替换 ${buildMs.toFixed(3)}/${queryP95.toFixed(3)}/${incrementalMs.toFixed(3)}ms`);
  }
  pagesSession.dispose();
  console.info(`查找替换 200 页索引/查询/增量 ${buildMs.toFixed(3)}/${queryP95.toFixed(3)}/${incrementalMs.toFixed(3)}ms`);
  console.info(`查找替换 60 元素导航/替换 p95 ${navigationP95.toFixed(3)}/${replaceP95.toFixed(3)}ms`);
  return { buildMs, queryP95, incrementalMs, navigationP95, replaceP95 };
}
