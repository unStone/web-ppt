import { bindCommentsTools } from './comments-tools';
import { prepareAdvancedRendering } from '@web-ppt/core/advanced-rendering';
import { prepareModernCharts } from '@web-ppt/core/modern-charts';
import { setFontDecoder } from '@web-ppt/core';
import {
  openEditor,
  type EditorContextRequest,
  type EditorMode,
  type EditorSession,
  type SelectionPane,
  type SlideEditor,
  type TouchNavigationChange,
} from '@web-ppt/editor';
import type { PresetAdjustmentEditor } from '@web-ppt/editor/adjustments';
import { createEditorInspector, type EditorInspector } from './editor-inspector';
import { createSlideInspector, type SlideInspector } from './editor-slide-inspector';
import { createProductTools } from './editor-product-tools';
import { createSiteRecovery } from './editor-recovery';
import { renderSlideNavigation } from './editor-slide-reorder';
import { bindContentTools } from './editor-content-tools';
import { createEditorFeedback } from './editor-feedback';
import { bindPaneLabels } from './editor-pane-labels';
import { bindViewLabels } from './editor-view-labels';
import { bindEditorFileOpen, createEditorFileActions } from './editor-file-actions';
import { whyFailed } from './fetch-bytes';
import { editorButtons as buttons, editorElements } from './editor-elements';
import type { ChartInspector } from './editor-chart-inspector';
import { languageReady, setAttributeMessage, setMessage, setText, t } from './i18n/runtime';
import { message, type SiteMessage } from './i18n/message';

const {
  app, toolbar, fileInput, fileName, canvasViewport, canvasMount, canvasState,
  objectList, slideList, slideCount, statusText, documentKind, pageIndicator,
  zoomLabel, dropLayer, inspectorElement,
} = editorElements;

let session: EditorSession | null = null;
let view: SlideEditor | null = null;
let pane: SelectionPane | null = null;
let releaseLabels: (() => void)[] = [];
let unsubscribeEditor: (() => void) | null = null;
let unregisterToolbar: (() => void) | null = null;
let unregisterInspector: (() => void) | null = null;
let inspector: EditorInspector | null = null;
let slideInspector: SlideInspector | null = null;
let adjustments: PresetAdjustmentEditor | null = null;
let chartInspector: ChartInspector | null = null;
let chartInspectorLoading: Promise<void> | null = null;
let mode: EditorMode = 'edit';
let zoom = 1;
let fitWanted = true;
let activeName = 'showcase.pptx';
let openGeneration = 0;
let openController: AbortController | null = null;
let pptConversionAccepted = false;
let newDocument = false;
let closeMediaTools: (() => void) | undefined;
let closeSlideSizeTools: (() => void) | undefined;
let languageInitialized = false;

function explain(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const { notice, reportError, previewAnimations } = createEditorFeedback(statusText);

function setLoading(value: string | SiteMessage): void {
  canvasState.hidden = false;
  setMessage(canvasState.querySelector('strong')!, value);
  setText(canvasState.querySelector('small')!, '解析和渲染完全在浏览器中进行');
  canvasState.querySelector('.spinner')?.removeAttribute('hidden');
  app.dataset.loading = 'true';
  syncControls();
}

function hideLoading(): void {
  canvasState.hidden = true;
  delete app.dataset.loading;
  syncControls();
}

function currentIndex(): number {
  if (!session || !view) return -1;
  return session.editor.doc.slideOrder.indexOf(view.slideId);
}

function canWriteDocument(): boolean {
  const doc = session?.editor.doc;
  return !!doc && !doc.meta.readonly;
}

function needsPptConversion(): boolean {
  return session?.editor.doc.meta.source === 'ppt' && !pptConversionAccepted;
}

function canMutateDocument(): boolean {
  return canWriteDocument() && !needsPptConversion();
}

function outputName(): string {
  const stem = activeName.replace(/\.(pptx?|potx?|ppsx?)$/i, '');
  if (newDocument) return `${stem}.pptx`;
  return session?.editor.doc.meta.source === 'ppt' ? `${stem}.pptx` : `${stem}-edited.pptx`;
}

function syncControls(): void {
  const editor = session?.editor;
  const loaded = !!editor && !app.dataset.loading;
  const ready = loaded && !fileActions.busy;
  const capable = ready && canWriteDocument();
  const writable = capable && !needsPptConversion();
  const index = currentIndex();
  buttons.newFile.disabled = !languageInitialized || !!app.dataset.loading || fileActions.busy;
  fileInput.disabled = !languageInitialized || !!app.dataset.loading || fileActions.busy;
  buttons.undo.disabled = !writable || mode !== 'edit' || !editor!.history.undoCount;
  buttons.redo.disabled = !writable || mode !== 'edit' || !editor!.history.redoCount;
  buttons.save.disabled = !writable;
  buttons.localSave.disabled = !writable;
  buttons.localSave.hidden = !fileActions.localAvailable;
  buttons.saveAs.disabled = !writable;
  buttons.saveAs.hidden = !fileActions.localAvailable || !fileActions.localTarget(session);
  setAttributeMessage(buttons.localSave, 'title', message('保存目标：{name}', { name: fileActions.localTarget(session) ?? message('请选择保存位置') }));
  buttons.exportImages.disabled = !ready;
  buttons.exportDocument.disabled = !ready;
  buttons.addShape.disabled = !writable || mode !== 'edit';
  buttons.addImage.disabled = !writable || mode !== 'edit';
  buttons.media.disabled = !writable || mode !== 'edit';
  slideSizeButton.disabled = !writable || mode !== 'edit';
  buttons.addTable.disabled = !writable || mode !== 'edit';
  buttons.addSlide.disabled = !writable || mode !== 'edit' || !editor!.doc.layoutOrder.length;
  buttons.play.disabled = !ready;
  buttons.inspector.disabled = !ready;
  buttons.edit.disabled = !capable;
  buttons.view.disabled = !ready;
  buttons.zoomOut.disabled = !ready;
  buttons.fit.disabled = !ready;
  buttons.zoomIn.disabled = !ready;
  buttons.prev.disabled = !ready || index <= 0;
  buttons.next.disabled = !ready || index < 0 || index >= editor!.doc.slideOrder.length - 1;
  buttons.edit.setAttribute('aria-pressed', String(mode === 'edit'));
  buttons.view.setAttribute('aria-pressed', String(mode === 'view'));
  const total = editor?.doc.slideOrder.length ?? 0;
  pageIndicator.textContent = index < 0 ? '— / —' : `${index + 1} / ${total}`;
  slideCount.textContent = String(total);
  if (!editor) {
    setText(documentKind, '未打开文稿');
  } else if (editor.doc.meta.readonly) {
    setText(documentKind, '{format} · 只读预览', { format: editor.doc.meta.source.toUpperCase() });
  } else {
    setText(documentKind, editor?.doc.meta.source === 'ppt'
      ? pptConversionAccepted ? 'PPT → PPTX · 可编辑' : 'PPT · 转换后可编辑' : 'PPTX · 可编辑');
  }
  const dirty = editor?.isDirty() ?? false;
  fileName.textContent = `${dirty ? '● ' : ''}${activeName}`;
  setText(document.querySelector('title')!, '{name} · Web-PPT 编辑器', { name: `${dirty ? '● ' : ''}${activeName}` });
  syncSlideSelection();
  inspector?.sync();
  syncChartInspector();
  slideInspector?.sync();
  productTools.sync();
  commentsTools.sync();
  commentsButton.disabled = !ready;
  recovery.sync(session);
}

function syncChartInspector(): void {
  if (chartInspector) { chartInspector.sync(); return; }
  const selection = session?.editor.selection;
  const id = selection?.kind === 'elements' && selection.ids.length === 1 ? selection.ids[0] : null;
  const record = id && session?.editor.doc.elements[id];
  if (!record || record.src.kind !== 'group' || record.meta.editable !== 'frame' || chartInspectorLoading) return;
  const owner = session;
  chartInspectorLoading = import('./editor-chart-inspector').then(({ createChartInspector }) => {
    chartInspector = createChartInspector(
      inspectorElement.querySelector<HTMLElement>('#chartInspector')!,
      () => ({ session, writable: canMutateDocument() && mode === 'edit' }), notice,
    );
    chartInspector.sync();
  }).catch((error) => {
    const current = session?.editor.selection;
    if (session !== owner || current?.kind !== 'elements' || current.ids.length !== 1 || current.ids[0] !== id) return;
    notice(message('无法加载图表工具：{detail}', { detail: explain(error) }), 'error');
  }).finally(() => { chartInspectorLoading = null; });
}

function syncSlideSelection(): void {
  const selected = view?.slideId;
  for (const item of slideList.querySelectorAll<HTMLButtonElement>('[data-slide-id]')) {
    item.setAttribute('aria-current', String(item.dataset.slideId === selected));
  }
}

function renderSlideList(): void {
  renderSlideNavigation(slideList, () => ({ session, showSlide, onError: reportError }));
  syncControls();
}

function showSlide(id: string): void {
  if (!session || !view || !session.editor.doc.slides[id]) return;
  view.setSlide(id);
  pane?.setSlide(id);
  syncControls();
  slideList.querySelector<HTMLElement>(`[data-slide-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
}

function handleViewSlideChange(id: string): void {
  if (!session?.editor.doc.slides[id]) return;
  pane?.setSlide(id);
  syncControls();
  slideList.querySelector<HTMLElement>(`[data-slide-id="${CSS.escape(id)}"]`)
    ?.scrollIntoView({ block: 'nearest' });
}

function setMode(next: EditorMode): void {
  if (!session || !view || next === 'edit' && !canWriteDocument()) return;
  if (next === 'edit' && needsPptConversion()) {
    const targetName = outputName();
    const accepted = window.confirm(t(
      '{name} 是旧版 .ppt。进入编辑后将另存为 {output}，不会覆盖原文件。未建模的旧格式内容将显示为带原因的框架占位，仅支持移动、缩放等框架级编辑。继续吗？',
      { name: activeName, output: targetName },
    ));
    if (!accepted) {
      syncControls();
      notice(message('已取消格式转换，继续以预览模式打开'));
      return;
    }
    pptConversionAccepted = true;
  }
  mode = next;
  view.setMode(next);
  pane?.setMode(next);
  syncControls();
  notice(message(next === 'edit' ? '编辑模式：双击文字，拖动或缩放元素' : '预览模式：点击链接并播放动画'));
}

function applyZoom(next: number): void {
  if (!session || !view) return;
  zoom = Math.min(2.5, Math.max(.15, next));
  view.setZoom(zoom);
  view.element.style.width = `${session.editor.doc.meta.width * zoom}px`;
  view.element.style.height = `${session.editor.doc.meta.height * zoom}px`;
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

function fitView(): void {
  if (!session || !view) return;
  const { width, height } = session.editor.doc.meta;
  const availableWidth = Math.max(100, canvasViewport.clientWidth - 56);
  const availableHeight = Math.max(100, canvasViewport.clientHeight - 56);
  applyZoom(Math.min(1.5, availableWidth / width, availableHeight / height));
}

function handleTouchNavigate(change: TouchNavigationChange): void {
  if (!session || !view || change.phase === 'cancel') return;
  zoom = change.viewport.zoom;
  fitWanted = false;
  view.element.style.width = `${session.editor.doc.meta.width * zoom}px`;
  view.element.style.height = `${session.editor.doc.meta.height * zoom}px`;
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  const stage = view.element.querySelector<HTMLElement>('[data-ppt-stage]');
  const rect = stage?.getBoundingClientRect();
  if (rect) {
    canvasViewport.scrollLeft += rect.left - change.viewport.left;
    canvasViewport.scrollTop += rect.top - change.viewport.top;
  }
}

function handleContextRequest(request: EditorContextRequest): void {
  notice(message(request.targetId ? '已长按选择对象；可用格式面板继续操作' : '已长按画布'));
}

function disposeCurrent(): void {
  closeSlideSizeTools?.(); closeSlideSizeTools = undefined;
  commentsTools.reset();
  releaseLabels.forEach((release) => release());
  releaseLabels = [];
  adjustments?.destroy();
  adjustments = null;
  unsubscribeEditor?.();
  unregisterToolbar?.();
  unregisterInspector?.();
  unsubscribeEditor = null;
  unregisterToolbar = null;
  unregisterInspector = null;
  session?.dispose();
  session = null;
  view = null;
  pane = null;
  canvasMount.replaceChildren();
  objectList.replaceChildren();
  slideList.replaceChildren();
}

function cancelPendingOpen(): void {
  recovery.cancelPending();
  openController?.abort(new DOMException('打开已被新请求取代', 'AbortError'));
  openController = null;
}

async function openDocument(
  source: File | Blob | ArrayBuffer | Uint8Array,
  name: string,
  options: { newDocument?: boolean } = {},
): Promise<void> {
  closeMediaTools?.();
  closeMediaTools = undefined;
  cancelPendingOpen();
  const generation = ++openGeneration;
  const controller = new AbortController();
  openController = controller;
  setLoading(message('正在打开 {name}', { name }));
  notice(message('正在解析 {name}…', { name }));
  try {
    // 拖放可绕过文件按钮的 disabled；先记录打开意图，再等待词库，防止迟到示例覆盖它。
    await languageReady;
    const { eotToTtf } = await import('mtx-decompressor');
    if (generation !== openGeneration) return;
    setFontDecoder(eotToTtf);
    const sourceBytes = source instanceof Blob ? await source.arrayBuffer() : source;
    await Promise.all([prepareModernCharts(sourceBytes), prepareAdvancedRendering(sourceBytes)]);
    if (generation !== openGeneration) return;
    const [{ createPresetAdjustmentEditor }, accessibility, inputEnhancement] = await Promise.all([
      import('@web-ppt/editor/adjustments'),
      import('@web-ppt/editor/accessibility').catch(() => undefined),
      'EditContext' in window ? import('@web-ppt/editor/edit-context').catch(() => undefined) : undefined,
    ]);
    if (generation !== openGeneration) return;
    const next = await openEditor(source, recovery.openOptions(controller.signal));
    if (generation !== openGeneration) {
      next.dispose();
      return;
    }
    if (Object.values(next.editor.doc.slides).some((record) => record.ovr.extensions?.comments !== undefined)) {
      const { registerCommentEditing } = await import('@web-ppt/edit-core/comments');
      registerCommentEditing();
      if (generation !== openGeneration) { next.dispose(); return; }
    }
    if (Object.values(next.editor.doc.elements).some((record) => record.ovr.extensions?.appearance !== undefined)) {
      const { registerAppearanceEditing } = await import('@web-ppt/edit-core/appearance');
      registerAppearanceEditing();
      if (generation !== openGeneration) { next.dispose(); return; }
    }
    if (Object.values(next.editor.doc.elements).some((record) =>
      record.ovr.extensions?.['chart-data'] !== undefined)) {
      await import('@web-ppt/editor/chart');
      if (generation !== openGeneration) { next.dispose(); return; }
    }
    if (Object.values(next.editor.doc.elements).some((record) => record.ovr.extensions?.['chart-design'] !== undefined)) {
      await import('@web-ppt/edit-core/chart-design');
      if (generation !== openGeneration) { next.dispose(); return; }
    }
    if (Object.values(next.editor.doc.elements).some((record) => record.ovr.extensions?.['chart-ex-data'] !== undefined)) {
      await import('@web-ppt/edit-core/chart-ex');
      if (generation !== openGeneration) { next.dispose(); return; }
    }
    if (Object.values(next.editor.doc.elements).some((record) => record.ovr.extensions?.ink !== undefined)) {
      await import('@web-ppt/edit-core/ink');
    }
    if (Object.values(next.editor.doc.elements).some((record) => record.ovr.extensions?.ole !== undefined)) {
      await import('@web-ppt/edit-core/ole');
    }
    if (Object.values(next.editor.doc.elements).some((record) => record.ovr.extensions?.smartart !== undefined)) {
      await import('@web-ppt/edit-core/smartart');
      if (generation !== openGeneration) { next.dispose(); return; }
    }
    disposeCurrent();
    session = next;
    activeName = name;
    newDocument = !!options.newDocument;
    pptConversionAccepted = false;
    mode = canWriteDocument() && next.editor.doc.meta.source !== 'ppt' ? 'edit' : 'view';
    view = next.mount(canvasMount, {
      mode, zoom: 1, snapping: true, onSlideChange: handleViewSlideChange,
      onTouchNavigate: handleTouchNavigate, onContextRequest: handleContextRequest,
      onError: reportError,
    });
    adjustments = createPresetAdjustmentEditor(next, view, { onError: reportError });
    pane = next.mountSelectionPane(objectList, { mode, ariaLabel: '当前页对象', onError: reportError });
    releaseLabels = [bindPaneLabels(next, pane), bindViewLabels(next, view)];
    if (accessibility) releaseLabels.push(accessibility.createCanvasAccessibility(next, view).dispose);
    if (inputEnhancement) releaseLabels.push(inputEnhancement.enableEditContext(next, view).dispose);
    // 语言入口属于宿主编辑工具；否则 document 捕获阶段会先关闭文字编辑，晚于此的防失焦无效。
    const releaseTools = [toolbar, document.querySelector<HTMLElement>('#siteLanguage')!]
      .map((element) => view!.registerTextUi(element));
    unregisterToolbar = () => releaseTools.forEach((release) => release());
    unregisterInspector = view.registerTextUi(inspectorElement);
    productTools.bindSession();
    unsubscribeEditor = next.editor.subscribe((change) => {
      if (change.createdSlides.size || change.removedSlides.size || change.movedSlides.size) renderSlideList();
      else syncControls();
      void recovery.flush(next);
    });
    renderSlideList();
    fitWanted = true;
    requestAnimationFrame(fitView);
    hideLoading();
    const readyMessage = next.editor.doc.meta.source === 'ppt'
      ? message('{name} 已打开；进入编辑时会先确认另存为 {output}', { name, output: outputName() })
      : next.editor.doc.meta.readonly
        ? message('{name} 已打开；当前文件缺少安全写回上下文，只能预览', { name })
        : message('{name} 已就绪，可直接选择、拖动或双击编辑文字', { name });
    notice(readyMessage, canWriteDocument() ? 'success' : 'normal');
    view.element.focus();
  } catch (error) {
    if (generation !== openGeneration) return;
    const failure = message('打开失败：{detail}', { detail: explain(error) });
    if (session) {
      hideLoading();
      notice(failure, 'error');
      view?.element.focus();
    } else {
      showOpenFailure(failure);
    }
  } finally {
    if (openController === controller) openController = null;
  }
}

function showOpenFailure(error: SiteMessage): void {
  canvasState.hidden = false;
  canvasState.querySelector('.spinner')?.setAttribute('hidden', '');
  setText(canvasState.querySelector('strong')!, '演示文稿打开失败');
  setMessage(canvasState.querySelector('small')!, error);
  delete app.dataset.loading;
  notice(error, 'error');
  syncControls();
}

function confirmReplacement(): boolean {
  return !session?.editor.isDirty() || window.confirm(t('当前修改还没有保存，仍然打开另一份文件吗？'));
}

function tryOpenLocalFile(file: File | undefined): void {
  if (fileActions.busy) {
    notice(message('文件任务完成前不能切换文稿'));
    return;
  }
  if (file && confirmReplacement()) void openDocument(file, file.name);
}

async function createNewDocument(): Promise<void> {
  if (fileActions.busy) {
    notice(message('文件任务完成前不能新建文稿'));
    return;
  }
  if (!confirmReplacement()) return;
  const created = await import('./editor-template-picker')
    .then(({ chooseNewDocument }) => chooseNewDocument())
    .catch((error: unknown) => (notice(message('新建失败：{detail}', { detail: explain(error) }), 'error'), null));
  if (!created) return;
  cancelPendingOpen();
  const generation = ++openGeneration;
  setLoading(created.loadingMessage);
  notice(created.noticeMessage);
  try {
    if (generation !== openGeneration) return;
    await openDocument(created.bytes, created.fileName, { newDocument: true });
  } catch (error) {
    if (generation !== openGeneration) return;
    const failure = message('新建失败：{detail}', { detail: explain(error) });
    if (session) {
      hideLoading();
      notice(failure, 'error');
      view?.element.focus();
    } else {
      showOpenFailure(failure);
    }
  }
}

async function run(action: () => void | Promise<void>): Promise<void> {
  try { await action(); } catch (error) { reportError(error); }
}

buttons.newFile.addEventListener('click', () => void createNewDocument());
buttons.media.addEventListener('click', () => void run(async () => {
  const current = session, generation = openGeneration;
  const { showMediaTools } = await import('./editor-media-tools');
  if (current !== session || generation !== openGeneration) return;
  const close = showMediaTools(() => ({ session, view,
    writable: canMutateDocument() && mode === 'edit' && !app.dataset.loading && !fileActions.busy }), notice,
  () => { if (closeMediaTools === close) closeMediaTools = undefined; });
  closeMediaTools = close ?? closeMediaTools;
}));
buttons.exportDocument.addEventListener('click', () => {
  const current = session;
  if (current) void fileActions.exportDocument(current, outputName(), commentsTools.showComments);
});
buttons.exportImages.addEventListener('click', () => {
  const current = session;
  if (current) void fileActions.exportImages(current, outputName(), commentsTools.showComments);
});
buttons.edit.addEventListener('click', () => setMode('edit'));
buttons.view.addEventListener('click', () => setMode('view'));
buttons.undo.addEventListener('click', () => {
  if (session?.editor.undo()) notice(message('已撤销上一步'));
  syncControls();
});
buttons.redo.addEventListener('click', () => {
  if (session?.editor.redo()) notice(message('已重做上一步'));
  syncControls();
});
buttons.prev.addEventListener('click', () => {
  const index = currentIndex();
  const id = index > 0 ? session?.editor.doc.slideOrder[index - 1] : undefined;
  if (id) showSlide(id);
});
buttons.next.addEventListener('click', () => {
  const index = currentIndex();
  const id = index >= 0 ? session?.editor.doc.slideOrder[index + 1] : undefined;
  if (id) showSlide(id);
});
bindContentTools(() => ({ session, view, showSlide }), notice);
buttons.play.addEventListener('click', () => void previewAnimations(view));
buttons.inspector.addEventListener('click', () => {
  if (app.dataset.inspectorOpen === 'true') closeInspector(); else openInspector();
});
buttons.zoomOut.addEventListener('click', () => { fitWanted = false; applyZoom(zoom - .1); });
buttons.zoomIn.addEventListener('click', () => { fitWanted = false; applyZoom(zoom + .1); });
buttons.fit.addEventListener('click', () => { fitWanted = true; fitView(); });
buttons.save.addEventListener('click', () => {
  const current = session;
  if (current && canMutateDocument()) void fileActions.saveCopy(current, outputName());
});
buttons.localSave.addEventListener('click', () => {
  if (session && canMutateDocument()) void fileActions.saveLocal(session, outputName());
});
buttons.saveAs.addEventListener('click', () => {
  if (session && canMutateDocument()) void fileActions.saveLocal(session, outputName(), true);
});

bindEditorFileOpen(fileInput, dropLayer, tryOpenLocalFile);

window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    // 锁内也要拦住浏览器“保存网页”，但不能把重复按键或 IME 提交当成保存意图。
    if (event.repeat || event.isComposing || !canMutateDocument() || fileActions.busy || app.dataset.loading) return;
    const current = session;
    if (current) void (fileActions.localAvailable
      ? fileActions.saveLocal(current, outputName(), event.shiftKey)
      : fileActions.saveCopy(current, outputName()));
  }
});
window.addEventListener('beforeunload', (event) => {
  if (!session?.editor.isDirty()) return;
  event.preventDefault();
  event.returnValue = '';
});
new ResizeObserver(() => { if (fitWanted) fitView(); }).observe(canvasViewport);

function openInspector(): void {
  app.dataset.inspectorOpen = 'true';
  buttons.inspector.setAttribute('aria-expanded', 'true');
}

function closeInspector(): void {
  app.dataset.inspectorOpen = 'false';
  buttons.inspector.setAttribute('aria-expanded', 'false');
}

const commentsButton = document.querySelector<HTMLButtonElement>('#commentsTools')!;
const slideSizeButton = document.querySelector<HTMLButtonElement>('#slideSizeTools')!;
slideSizeButton.onclick = () => { void run(async () => {
  const current = session;
  if (!current || !canMutateDocument() || mode !== 'edit') return;
  const { showSlideSizeTools } = await import('./editor-resize-tools');
  if (session !== current) return;
  closeSlideSizeTools?.(); closeSlideSizeTools = showSlideSizeTools(current, () => session);
}); };
const commentsTools = bindCommentsTools(commentsButton, () => {
  const current = session, slideId = view?.slideId;
  return current && slideId ? { owner: current, editing: { editor: current.editor, slideId, writable: canMutateDocument() && mode === 'edit' }, slide: current.editor.toSlide(slideId), presentation: () => current.toPresentation(), name: activeName } : null;
});
const recovery = createSiteRecovery(notice);
const fileActions = createEditorFileActions({
  notice, onBusyChange: syncControls, onSaved: (saved) => { void recovery.flush(saved); },
});
const productTools = createProductTools(() => ({
  session, view, writable: canMutateDocument() && mode === 'edit', openInspector,
}), notice);
inspector = createEditorInspector(inspectorElement, () => ({
  session, view, adjustments, writable: canMutateDocument() && mode === 'edit',
}), notice);
slideInspector = createSlideInspector(inspectorElement, () => ({
  session, view, writable: canMutateDocument() && mode === 'edit', showSlide,
}), notice);

buttons.newFile.disabled = true;
fileInput.disabled = true;
void languageReady.then(() => {
  languageInitialized = true;
  syncControls();
  return fetch(new URL('./demo/showcase.pptx', document.baseURI));
})
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.arrayBuffer();
  })
  // 用户可能在示例下载完成前已经选择了本地文件；迟到的示例不能覆盖用户意图。
  .then((bytes) => openGeneration ? undefined : openDocument(bytes, 'showcase.pptx'))
  .catch((error) => {
    if (!openGeneration) showOpenFailure(message('示例下载失败：{detail}。仍可打开本地文件或新建文稿。', { detail: whyFailed(error) }));
  });
