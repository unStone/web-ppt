const mountPoint = () => {
  const element = document.createElement('div');
  element.className = 'contract-offscreen';
  document.body.append(element);
  return element;
};

const key = (target, value) => target.dispatchEvent(new KeyboardEvent('keydown', {
  key: value, bubbles: true, cancelable: true,
}));

const click = (target) => target.dispatchEvent(new MouseEvent('click', {
  bubbles: true, cancelable: true,
}));

const byName = (session, name) => Object.values(session.editor.doc.elements)
  .find((record) => record.src.name === name || record.ovr.name === name);

const rowFor = (paneMount, id) => paneMount.querySelector(`[data-pane-element="${id}"]`);

export async function runEditorSelectionPaneBrowserContract({
  openEditor, createWebPptAdapter, load,
}) {
  const canvasMount = mountPoint();
  const paneMount = mountPoint();
  const session = await openEditor(await load('sample-editor-selection-pane.pptx'), {
    idPrefix: 'browser-selection-pane-',
  });
  const view = session.mount(canvasMount, { mode: 'edit', textMode: 'svg', snapping: false });
  const pane = session.mountSelectionPane(paneMount, { mode: 'edit' });
  const tree = paneMount.querySelector('[role="tree"]');
  const initialRows = [...paneMount.querySelectorAll('[role="treeitem"]')];
  const outer = byName(session, 'pane-outer-group');
  const inner = byName(session, 'pane-inner-group');
  const child = byName(session, 'pane-child');
  const duplicate = byName(session, 'pane-duplicate');
  if (!tree || tree.getAttribute('aria-label') !== '幻灯片对象'
    || initialRows[0]?.getAttribute('aria-label')?.startsWith('pane-unknown-frame') !== true
    || rowFor(paneMount, outer.id)?.getAttribute('aria-level') !== '1'
    || rowFor(paneMount, inner.id)?.getAttribute('aria-level') !== '2'
    || rowFor(paneMount, child.id)?.getAttribute('aria-level') !== '3') {
    throw new Error('选择窗格 tree 语义、层级或自顶向下顺序错误');
  }

  const duplicateRow = rowFor(paneMount, duplicate.id);
  const duplicateSvg = canvasMount.querySelector(`[data-edit-root="${duplicate.id}"]`);
  const rootSvg = canvasMount.querySelector('[data-ppt-layer="static"] svg');
  session.editor.exec({ type: 'SetXfrm', id: duplicate.id, x: duplicate.src.x + 3 });
  if (rowFor(paneMount, duplicate.id) !== duplicateRow
    || canvasMount.querySelector(`[data-edit-root="${duplicate.id}"]`) === duplicateSvg
    || canvasMount.querySelector('[data-ppt-layer="static"] svg') !== rootSvg) {
    throw new Error('几何修改错误重建了选择窗格或整页 SVG');
  }

  click(duplicateRow.querySelector('[data-pane-name]'));
  if (session.editor.selection.kind !== 'elements'
    || session.editor.selection.ids[0] !== duplicate.id
    || duplicateRow.getAttribute('aria-selected') !== 'true') {
    throw new Error('选择窗格点击没有同步画布选区');
  }
  duplicateRow.focus();
  key(duplicateRow, 'F2');
  const rename = duplicateRow.querySelector('input');
  if (!rename) throw new Error('F2 没有进入重命名');
  rename.value = '键盘重命名对象';
  key(rename, 'Enter');
  if (session.editor.doc.elements[duplicate.id].ovr.name !== '键盘重命名对象'
    || rowFor(paneMount, duplicate.id) !== duplicateRow
    || duplicateRow.querySelector('[data-pane-name]')?.textContent !== '键盘重命名对象') {
    throw new Error('重命名没有增量同步稳定行 DOM');
  }

  const outerRow = rowFor(paneMount, outer.id);
  outerRow.focus();
  key(outerRow, 'ArrowLeft');
  if (outerRow.getAttribute('aria-expanded') !== 'false' || !rowFor(paneMount, inner.id).hidden) {
    throw new Error('ArrowLeft 没有折叠组合');
  }
  key(outerRow, 'ArrowRight');
  if (outerRow.getAttribute('aria-expanded') !== 'true' || rowFor(paneMount, inner.id).hidden) {
    throw new Error('ArrowRight 没有展开组合');
  }
  key(outerRow, 'End');
  if (document.activeElement !== initialRows.at(-1)) throw new Error('End 没有移动到最后一个可见树项');
  key(initialRows.at(-1), 'Home');
  if (document.activeElement !== initialRows[0]) throw new Error('Home 没有移动到第一个树项');

  outerRow.focus();
  key(outerRow, ' ');
  const outerPartition = canvasMount.querySelector(`[data-edit-root="${outer.id}"]`);
  const childPartition = canvasMount.querySelector(`[data-edit-root="${child.id}"]`);
  if (outerPartition.style.visibility !== 'hidden' || childPartition.style.visibility !== ''
    || !rowFor(paneMount, child.id).hasAttribute('data-hidden')
    || !rowFor(paneMount, child.id).querySelector('[data-pane-action="visibility"]').disabled) {
    throw new Error('组隐藏没有通过继承生效，或子元素错误写入 visible');
  }
  const hiddenChildRow = rowFor(paneMount, child.id);
  hiddenChildRow.focus();
  key(hiddenChildRow, 'F2');
  if (hiddenChildRow.querySelector('input')) throw new Error('隐藏对象仍能借选择窗格重命名');
  key(outerRow, ' ');
  if (outerPartition.style.visibility !== '' || childPartition.style.visibility !== '') {
    throw new Error('显示组合没有删除 visibility 声明');
  }

  click(rowFor(paneMount, child.id).querySelector('[data-pane-name]'));
  click(outerRow.querySelector('[data-pane-action="lock"]'));
  let rejected = false;
  try { session.editor.exec({ type: 'SetFill', id: child.id, fill: null }); } catch { rejected = true; }
  if (session.editor.selection.kind !== 'none' || !rejected
    || !rowFor(paneMount, child.id).querySelector('[data-pane-action="lock"]').disabled) {
    throw new Error('锁定组合没有清理子选区、禁用继承控制或阻止内容命令');
  }
  const lockedChildRow = rowFor(paneMount, child.id);
  lockedChildRow.focus();
  key(lockedChildRow, 'F2');
  if (lockedChildRow.querySelector('input')) throw new Error('锁定对象仍能借选择窗格重命名');
  click(outerRow.querySelector('[data-pane-action="lock"]'));

  pane.setMode('view');
  const beforeViewHidden = !!session.editor.doc.elements[duplicate.id].meta.hiddenByUser;
  duplicateRow.focus();
  key(duplicateRow, ' ');
  click(duplicateRow.querySelector('[data-pane-name]'));
  if (!!session.editor.doc.elements[duplicate.id].meta.hiddenByUser !== beforeViewHidden
    || !duplicateRow.querySelector('[data-pane-action="visibility"]').disabled) {
    throw new Error('查看模式的选择窗格越权修改模型');
  }
  pane.setMode('edit');
  pane.setSlide(session.editor.doc.slideOrder[1]);
  if (paneMount.querySelectorAll('[role="treeitem"]').length !== 1
    || paneMount.querySelector('[data-pane-name]')?.textContent !== 'pane-second-slide') {
    throw new Error('选择窗格切页没有替换当前页目录');
  }
  pane.setSlide(view.slideId);

  const adapterCanvas = mountPoint();
  const adapterPaneMount = mountPoint();
  const adapter = createWebPptAdapter();
  adapter.attach(adapterCanvas);
  adapter.attachSelectionPane(adapterPaneMount);
  await adapter.setDocument({ session, ownership: 'external' });
  adapter.setView({ slideId: session.editor.doc.slideOrder[1], mode: 'view' });
  const adapterPane = adapter.snapshot.selectionPane;
  if (!adapterPane || adapterPane.slideId !== session.editor.doc.slideOrder[1]
    || adapterPane.mode !== 'view' || adapterPaneMount.querySelectorAll('[role="treeitem"]').length !== 1) {
    throw new Error('共享 adapter 没有统一选择窗格的文档、页与模式生命周期');
  }
  adapter.attachSelectionPane(null);
  if (!adapterPane.destroyed || adapterPaneMount.childElementCount !== 0) {
    throw new Error('adapter 解绑选择窗格后仍遗留 DOM 或订阅');
  }
  adapter.dispose();
  if (session.disposed) throw new Error('adapter 错误释放外部会话');
  adapterCanvas.remove();
  adapterPaneMount.remove();

  pane.destroy();
  view.destroy();
  session.dispose();
  canvasMount.remove();
  paneMount.remove();

  const layoutMount = mountPoint();
  const layoutSession = await openEditor(await load('sample-editor-change-layout.pptx'), {
    idPrefix: 'browser-selection-layout-',
  });
  const layoutPane = layoutSession.mountSelectionPane(layoutMount, { mode: 'edit' });
  const staleInherited = new Set([...layoutMount.querySelectorAll('[data-pane-element]')]
    .map((row) => row.dataset.paneElement)
    .filter((id) => layoutSession.editor.doc.elements[id]?.meta.inherited));
  const targetLayout = layoutSession.editor.doc.layoutOrder.find((id) =>
    layoutSession.editor.doc.layouts[id].name === '重点内容');
  layoutSession.editor.exec({ type: 'SetLayout', id: layoutPane.slideId, layoutId: targetLayout });
  const projectedIds = [...layoutMount.querySelectorAll('[data-pane-element]')]
    .map((row) => row.dataset.paneElement);
  if (projectedIds.some((id) => staleInherited.has(id))) {
    throw new Error('换版式后选择窗格没有移除旧继承对象');
  }
  layoutSession.editor.undo();
  if (![...layoutMount.querySelectorAll('[data-pane-element]')]
    .some((row) => staleInherited.has(row.dataset.paneElement))) {
    throw new Error('撤销换版式没有恢复来源交互树');
  }
  layoutPane.destroy();
  layoutSession.dispose();
  layoutMount.remove();

  const performanceMount = mountPoint();
  const performanceSession = await openEditor(await load('sample-editor-60.pptx'), {
    idPrefix: 'browser-selection-pane-performance-',
  });
  const performancePane = performanceSession.mountSelectionPane(performanceMount, { mode: 'edit' });
  const ids = performanceSession.editor.doc.slides[performancePane.slideId].children;
  const stableRow = rowFor(performanceMount, ids[0]);
  const samples = [];
  for (let index = 0; index < 80; index++) {
    const started = performance.now();
    performanceSession.editor.exec({ type: 'SetLocked', id: ids[index % ids.length], locked: true });
    performanceSession.editor.exec({ type: 'SetLocked', id: ids[index % ids.length], locked: false });
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  const p95 = samples[Math.floor(samples.length * 0.95)];
  if (ids.length !== 60 || p95 > 16 || rowFor(performanceMount, ids[0]) !== stableRow) {
    throw new Error(`60 元素选择窗格锁定往返 p95 ${p95.toFixed(3)}ms`);
  }
  performanceSession.editor.exec({
    type: 'SetXfrm', id: ids[0], x: performanceSession.editor.doc.elements[ids[0]].src.x + 1,
  });
  if (rowFor(performanceMount, ids[0]) !== stableRow) {
    throw new Error('无关几何修改重建了 60 元素选择窗格 DOM');
  }
  performancePane.destroy();
  performanceSession.dispose();
  performanceMount.remove();
  return { p95 };
}
