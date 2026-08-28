import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const mountPoint = () => {
  const element = document.createElement('div');
  element.className = 'contract-offscreen';
  document.body.append(element);
  return element;
};

const byName = (session, name) => Object.values(session.editor.doc.elements)
  .find((record) => record.src.name === name);

const endOf = (body) => {
  const p = body.paragraphs.length - 1;
  const r = body.paragraphs[p].runs.length - 1;
  return { p, r: Math.max(r, 0), off: r < 0 ? 0 : body.paragraphs[p].runs[r].text.length };
};

const whole = (body) => ({ from: { p: 0, r: 0, off: 0 }, to: endOf(body) });

const pointer = (target, pointerId = 1) => {
  const rect = target.getBoundingClientRect();
  const init = {
    bubbles: true, composed: true, cancelable: true, pointerType: 'mouse', pointerId,
    isPrimary: true, button: 0, clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };
  target.dispatchEvent(new PointerEvent('pointerdown', { ...init, buttons: 1 }));
  target.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
};

const rootFor = (mount, id) => mount.querySelector(`[data-edit-root="${id}"]`);

/** 真实 DOM 只路由一个会话格式刷；多视图和 adapter 不允许复制状态机。 */
export async function runEditorFormatPainterBrowserContract({
  openEditor, createWebPptAdapter, load,
}) {
  const firstMount = mountPoint();
  const secondMount = mountPoint();
  const adapterMount = mountPoint();
  const session = await openEditor(await load('sample-editor-format-painter.pptx'), {
    idPrefix: 'browser-format-painter-',
  });
  const [firstSlide, secondSlide] = session.editor.doc.slideOrder;
  const first = session.mount(firstMount, { mode: 'edit', slideId: firstSlide, textMode: 'svg' });
  const second = session.mount(secondMount, { mode: 'edit', slideId: secondSlide, textMode: 'svg' });
  const source = byName(session, 'format-source');
  const local = byName(session, 'format-target-local');
  const cross = byName(session, 'format-target-cross-page');
  const empty = byName(session, 'format-empty-source');
  const picture = byName(session, 'format-picture');
  const imageFill = byName(session, 'format-image-fill-shape');
  const table = byName(session, 'format-table');
  if ([source, local, cross, empty, picture, imageFill, table].some((record) => !record)) {
    throw new Error('格式刷浏览器固件缺少稳定元素');
  }

  session.editor.select({ kind: 'elements', ids: [source.id], enteredGroup: null });
  const targetBefore = rootFor(firstMount, local.id);
  const siblingBefore = rootFor(firstMount, empty.id);
  const svgBefore = firstMount.querySelector('[data-ppt-layer="static"] svg');
  const sourceFill = structuredClone(session.editor.effectiveElement(source.id).fill);
  const historyBefore = session.editor.history.undoCount;
  if (!first.startFormatPainter()
    || session.formatPainter.snapshot.mode !== 'single'
    || first.element.dataset.formatPainter !== 'single'
    || second.element.dataset.formatPainter !== 'single') {
    throw new Error('单次格式刷没有从当前单选建立全会话状态');
  }
  pointer(targetBefore);
  if (session.formatPainter.snapshot.active
    || first.element.hasAttribute('data-format-painter')
    || second.element.hasAttribute('data-format-painter')
    || session.editor.selection.kind !== 'elements'
    || session.editor.selection.ids[0] !== local.id
    || JSON.stringify(session.editor.effectiveElement(local.id).fill) !== JSON.stringify(sourceFill)
    || session.editor.history.undoCount !== historyBefore + 1
    || rootFor(firstMount, local.id) === targetBefore
    || rootFor(firstMount, empty.id) !== siblingBefore
    || firstMount.querySelector('[data-ppt-layer="static"] svg') !== svgBefore) {
    throw new Error('单次格式刷没有先原子应用、再选中目标、然后退出，或破坏了 DOM 增量边界');
  }

  session.editor.select({ kind: 'elements', ids: [source.id], enteredGroup: null });
  if (!first.startFormatPainter({ continuous: true })) throw new Error('连续格式刷启用失败');
  const sourceGeometry = JSON.stringify({
    x: session.editor.effectiveElement(source.id).x,
    y: session.editor.effectiveElement(source.id).y,
    w: session.editor.effectiveElement(source.id).w,
    h: session.editor.effectiveElement(source.id).h,
  });
  const resizeHandle = firstMount.querySelector('[data-edit-handle="nw"]');
  const handleRect = resizeHandle.getBoundingClientRect();
  const handleEvent = (type, x, y, buttons) => new PointerEvent(type, {
    bubbles: true, composed: true, cancelable: true, pointerType: 'mouse', pointerId: 20,
    isPrimary: true, button: 0, buttons, clientX: x, clientY: y,
  });
  resizeHandle.dispatchEvent(handleEvent(
    'pointerdown', handleRect.left + 4, handleRect.top + 4, 1,
  ));
  first.element.dispatchEvent(handleEvent(
    'pointermove', handleRect.left + 34, handleRect.top + 24, 1,
  ));
  first.element.dispatchEvent(handleEvent(
    'pointerup', handleRect.left + 34, handleRect.top + 24, 0,
  ));
  if (JSON.stringify({
    x: session.editor.effectiveElement(source.id).x,
    y: session.editor.effectiveElement(source.id).y,
    w: session.editor.effectiveElement(source.id).w,
    h: session.editor.effectiveElement(source.id).h,
  }) !== sourceGeometry) {
    throw new Error('格式刷激活时选择手柄仍越权修改几何');
  }
  pointer(rootFor(secondMount, cross.id), 2);
  if (!session.formatPainter.snapshot.active
    || session.formatPainter.snapshot.mode !== 'continuous'
    || session.editor.selection.kind !== 'elements'
    || session.editor.selection.ids[0] !== cross.id
    || second.element.dataset.formatPainter !== 'continuous') {
    throw new Error('连续格式刷没有保留来源并跨页/跨视图应用');
  }
  first.element.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, cancelable: true,
  }));
  if (session.formatPainter.snapshot.active) throw new Error('Escape 没有退出会话格式刷');

  const errors = [];
  first.element.addEventListener('webpptformaterror', (event) => errors.push(event.detail));
  session.editor.select({ kind: 'elements', ids: [source.id], enteredGroup: null });
  first.startFormatPainter({ continuous: true });
  pointer(rootFor(firstMount, picture.id), 3);
  if (!session.formatPainter.snapshot.active || errors.length !== 1
    || session.editor.selection.kind !== 'elements'
    || session.editor.selection.ids[0] !== source.id) {
    throw new Error('不兼容目标没有通过统一错误 seam 报告，或错误后丢失格式刷来源');
  }
  session.formatPainter.cancel();

  session.editor.select({ kind: 'elements', ids: [imageFill.id], enteredGroup: null });
  const imageFillTargetBefore = structuredClone(session.editor.effectiveElement(local.id).fill);
  if (!first.startFormatPainter({ continuous: true })
    || session.formatPainter.snapshot.source.mask.includes('fill')) {
    throw new Error('图片填充形状的安全默认掩码仍包含媒体内容');
  }
  pointer(rootFor(firstMount, local.id), 30);
  if (!session.formatPainter.snapshot.active
    || JSON.stringify(session.editor.effectiveElement(local.id).fill)
      !== JSON.stringify(imageFillTargetBefore)) {
    throw new Error('图片填充形状不能在跳过媒体填充后继续复制描边与效果');
  }
  session.formatPainter.cancel();

  session.editor.exec({ type: 'SetLocked', id: local.id, locked: true });
  session.editor.select({ kind: 'elements', ids: [source.id], enteredGroup: null });
  first.startFormatPainter({ continuous: true });
  const lockedHistory = session.editor.history.undoCount;
  pointer(rootFor(firstMount, local.id), 4);
  if (!session.formatPainter.snapshot.active || session.editor.history.undoCount !== lockedHistory
    || session.editor.selection.kind !== 'elements'
    || session.editor.selection.ids[0] !== source.id) {
    throw new Error('锁定目标没有在指针路由层跳过');
  }
  session.formatPainter.cancel();
  session.editor.exec({ type: 'SetLocked', id: local.id, locked: false });

  session.editor.select({ kind: 'elements', ids: [source.id], enteredGroup: null });
  first.startFormatPainter({ continuous: true });
  second.setMode('view');
  if (session.formatPainter.snapshot.active) throw new Error('切换查看模式没有立即退出格式刷');
  second.setMode('edit');

  const sourceBody = session.editor.effectiveElement(source.id).text;
  session.editor.select({
    kind: 'text', id: source.id, anchor: whole(sourceBody).from, focus: whole(sourceBody).to,
  });
  const localText = session.editor.effectiveElement(local.id).text.paragraphs
    .flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join('\n');
  first.startFormatPainter();
  if (!Object.isFrozen(session.formatPainter.snapshot.source.range)
    || !Object.isFrozen(session.formatPainter.snapshot.source.range.from)
    || !Object.isFrozen(session.formatPainter.snapshot.source.range.to)) {
    throw new Error('格式刷公开快照泄漏了可变文字位置');
  }
  pointer(rootFor(firstMount, local.id), 5);
  const formattedLocal = session.editor.effectiveElement(local.id).text;
  if (formattedLocal.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join('\n') !== localText
    || formattedLocal.paragraphs[0].runs[0].size !== sourceBody.paragraphs[0].runs[0].size) {
    throw new Error('文字选区格式刷改写了内容或没有复制字符格式');
  }

  const tableBody = session.editor.effectiveElement(table.id).rows[0].cells[0].text;
  session.editor.select({
    kind: 'text', id: table.id, cell: { r: 0, c: 0 },
    anchor: whole(tableBody).from, focus: whole(tableBody).to,
  });
  first.startFormatPainter();
  const targetCell = firstMount.querySelector(
    `[data-edit-root="${table.id}"] [data-table-cell="0:1"]`,
  );
  if (!targetCell) throw new Error('格式刷固件没有单元格 DOM 身份');
  pointer(targetCell, 6);
  const tableAfter = session.editor.effectiveElement(table.id);
  if (tableAfter.rows[0].cells[1].text.paragraphs[0].runs[0].b
      !== tableAfter.rows[0].cells[0].text.paragraphs[0].runs[0].b
    || tableAfter.rows[0].cells[1].text.paragraphs[0].runs[0].text !== '单元格 B') {
    throw new Error('单元格文字格式刷没有保留目标内容');
  }

  session.editor.select({ kind: 'elements', ids: [empty.id], enteredGroup: null });
  first.startFormatPainter({ continuous: true });
  session.editor.exec({ type: 'RemoveElement', id: empty.id });
  if (session.formatPainter.snapshot.active) throw new Error('来源删除后格式刷没有自动退出');

  const adapterErrors = [];
  const adapter = createWebPptAdapter({ onError: (error) => adapterErrors.push(error) });
  adapter.attach(adapterMount);
  await adapter.setDocument({ session, ownership: 'external' });
  adapter.setView({ mode: 'edit', slideId: firstSlide });
  session.editor.select({ kind: 'elements', ids: [source.id], enteredGroup: null });
  if (!adapter.startFormatPainter({ continuous: true })
    || !adapter.snapshot.formatPainter.active || adapter.snapshot.formatPainter.readonly) {
    throw new Error('adapter 没有暴露格式刷启用动作与可读快照');
  }
  pointer(rootFor(adapterMount, picture.id), 7);
  if (adapterErrors.length !== 1 || !adapter.snapshot.formatPainter.active) {
    throw new Error('adapter 没有把格式刷错误接入统一 onError 且保留模式');
  }
  adapter.cancelFormatPainter();
  adapter.setView({ mode: 'view' });
  if (adapter.startFormatPainter() || !adapter.snapshot.formatPainter.readonly) {
    throw new Error('adapter 查看模式没有暴露格式刷只读状态');
  }
  adapter.dispose();
  if (adapterErrors.length !== 1 || session.disposed) {
    throw new Error('adapter 格式刷生命周期破坏了外部会话');
  }
  const headlessAdapter = createWebPptAdapter();
  await headlessAdapter.setDocument({ session, ownership: 'external' });
  headlessAdapter.setView({ mode: 'edit' });
  session.editor.select({ kind: 'elements', ids: [source.id], enteredGroup: null });
  if (!headlessAdapter.startFormatPainter({ continuous: true })) {
    throw new Error('无容器 adapter 不能启用会话格式刷');
  }
  headlessAdapter.setView({ mode: 'view' });
  if (session.formatPainter.snapshot.active) {
    throw new Error('无容器 adapter 切到 view 没有退出会话格式刷');
  }
  session.editor.select({ kind: 'elements', ids: [source.id], enteredGroup: null });
  if (!first.startFormatPainter({ continuous: true })) {
    throw new Error('edit 视图不能在另一个 view adapter 存在时启用格式刷');
  }
  headlessAdapter.setView({ zoom: 1.1 });
  if (!session.formatPainter.snapshot.active) {
    throw new Error('已处于 view 的 adapter 更新缩放误取消了其它 edit 视图的格式刷');
  }
  session.formatPainter.cancel();
  headlessAdapter.dispose();

  first.destroy();
  second.destroy();
  session.editor.select({ kind: 'elements', ids: [source.id], enteredGroup: null });
  session.formatPainter.start({ continuous: true });
  let disposeReentryRejected = false;
  session.formatPainter.subscribe((snapshot) => {
    if (snapshot.active) return;
    try { session.formatPainter.start(); } catch { disposeReentryRejected = true; }
  });
  session.dispose();
  if (!session.formatPainter.disposed || session.formatPainter.snapshot.active
    || !disposeReentryRejected) {
    throw new Error('会话销毁没有先封闭重入再退出格式刷');
  }
  firstMount.remove();
  secondMount.remove();
  adapterMount.remove();

  const perfMount = mountPoint();
  const perfSession = await openEditor(await load('sample-editor-60.pptx'), {
    idPrefix: 'browser-format-painter-perf-',
  });
  const perfView = perfSession.mount(perfMount, { mode: 'edit', textMode: 'svg' });
  const ids = perfSession.editor.doc.slides[perfView.slideId].children;
  perfSession.editor.select({ kind: 'elements', ids: [ids[0]], enteredGroup: null });
  perfView.startFormatPainter({ continuous: true });
  const samples = [];
  for (let index = 0; index < 80; index++) {
    const target = rootFor(perfMount, ids[1 + index % (ids.length - 1)]);
    const started = performance.now();
    pointer(target, 100 + index);
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  const p95 = samples[Math.floor(samples.length * 0.95)];
  if (ids.length !== 60 || !perfSession.formatPainter.snapshot.active) {
    throw new Error('60 元素格式刷完整反馈后没有保持连续刷状态');
  }
  recordPerformanceBudget('60 元素格式刷完整反馈 p95', p95, 16);
  perfSession.formatPainter.cancel();
  perfView.destroy();
  perfSession.dispose();
  perfMount.remove();
  return { p95 };
}
