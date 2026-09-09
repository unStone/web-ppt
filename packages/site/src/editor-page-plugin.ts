import type { Context } from 'cordis';
import type { EditorApplication } from './editor-application';
import type { EditorDocument, EditorHost } from './editor-document-plugins';
import type { EditorFileHost } from './editor-files-plugin';
import type { EditorOpenHost } from './editor-open-plugin';
import { prepareEditorDocument } from './editor-open';
import { createEditorFeedback } from './editor-feedback';
import { createEditorViewport } from './editor-viewport';
import { editorButtons as buttons, editorElements } from './editor-elements';
import { setAttributeMessage, setMessage, setText, t } from './i18n/runtime';
import { message, type SiteMessage, type SiteNotice } from './i18n/message';

export interface EditorPage {
  readonly current: EditorDocument | null;
  readonly notice: SiteNotice;
  readonly host: EditorHost;
  readonly fileHost: EditorFileHost;
  readonly openHost: EditorOpenHost;
  connect(application: EditorApplication): void;
  stop(): void;
}

declare module 'cordis' { interface Context { editorPage: EditorPage } }

/** 页面状态和资源与服务在同一 Cordis 应用中，入口模块只负责首次启动与失败重试。 */
export const editorPagePlugin = {
  name: 'editor-page',
  apply(ctx: Context) {
    ctx.effect(function* () {
      const lifetime = new AbortController();
      yield () => lifetime.abort();
      const page = createPage(lifetime);
      yield page.release;
      yield ctx.provide('editorPage', page);
    });
  },
};

function createPage(lifetime: AbortController): EditorPage & { release(): void } {
  const { signal } = lifetime;
  const { app, toolbar, fileInput, fileName, canvasMount, canvasState, objectList,
    slideList, slideCount, statusText, documentKind, pageIndicator, zoomLabel,
    dropLayer, inspectorElement } = editorElements;
  const commentsButton = document.querySelector<HTMLButtonElement>('#commentsTools')!;
  const slideSizeButton = document.querySelector<HTMLButtonElement>('#slideSizeTools')!;
  let application: EditorApplication | undefined;
  let current: EditorDocument | null = null;
  let stopped = false, released = false;
  let activeName = 'showcase.pptx', pptConversionAccepted = false, newDocument = false;
  const feedback = createEditorFeedback(statusText, signal);
  const { notice, reportError } = feedback;
  const canWriteDocument = () => !!current && !current.session.editor.doc.meta.readonly;
  const needsPptConversion = () => current?.session.editor.doc.meta.source === 'ppt' && !pptConversionAccepted;
  const canMutateDocument = () => canWriteDocument() && !needsPptConversion();
  const ready = () => !signal.aborted && !!current && !app.dataset.loading && !application?.files.busy;
  const outputName = () => {
    const stem = activeName.replace(/\.(pptx?|potx?|ppsx?)$/i, '');
    return newDocument || current?.session.editor.doc.meta.source === 'ppt' ? `${stem}.pptx` : `${stem}-edited.pptx`;
  };
  const viewport = createEditorViewport(() => ({ document: current, ready: ready(), writable: canWriteDocument(),
    conversionRequired: !!needsPptConversion(), name: activeName, outputName: outputName(),
    acceptConversion() { pptConversionAccepted = true; }, sync: syncControls }), feedback, signal);

  function syncControls(): void {
    if (signal.aborted) return;
    const editor = current?.session.editor, files = application?.files;
    const loaded = ready(), capable = loaded && canWriteDocument(), writable = capable && !needsPptConversion();
    const index = viewport.index(), mode = viewport.mode;
    buttons.newFile.disabled = !application || !!app.dataset.loading || !!files?.busy;
    fileInput.disabled = buttons.newFile.disabled;
    buttons.undo.disabled = !writable || mode !== 'edit' || !editor!.history.undoCount;
    buttons.redo.disabled = !writable || mode !== 'edit' || !editor!.history.redoCount;
    buttons.save.disabled = !writable;
    buttons.localSave.disabled = !writable;
    buttons.localSave.hidden = !files?.localAvailable;
    buttons.saveAs.disabled = !writable;
    buttons.saveAs.hidden = !files?.localAvailable || !files?.localTarget(current?.session ?? null);
    setAttributeMessage(buttons.localSave, 'title', message('保存目标：{name}', { name: files?.localTarget(current?.session ?? null) ?? message('请选择保存位置') }));
    buttons.exportImages.disabled = !loaded;
    buttons.fonts.disabled = !loaded;
    setAttributeMessage(buttons.fonts,'title',message(current?.fonts?.state().initialIssues
      ? '部分字体无法用于编辑，请打开字体工具检查' : '字体与缺字'));
    buttons.exportDocument.disabled = !loaded;
    for (const button of [buttons.addShape, buttons.addImage, buttons.media, slideSizeButton, buttons.addTable]) {
      button.disabled = !writable || mode !== 'edit';
    }
    buttons.addSlide.disabled = !writable || mode !== 'edit' || !editor!.doc.layoutOrder.length;
    for (const button of [buttons.play, buttons.inspector, buttons.view, buttons.zoomOut, buttons.fit, buttons.zoomIn]) {
      button.disabled = !loaded;
    }
    buttons.edit.disabled = !capable;
    buttons.prev.disabled = !loaded || index <= 0;
    buttons.next.disabled = !loaded || index < 0 || index >= editor!.doc.slideOrder.length - 1;
    buttons.edit.setAttribute('aria-pressed', String(mode === 'edit'));
    buttons.view.setAttribute('aria-pressed', String(mode === 'view'));
    const total = editor?.doc.slideOrder.length ?? 0;
    pageIndicator.textContent = index < 0 ? '— / —' : `${index + 1} / ${total}`;
    slideCount.textContent = String(total);
    if (!editor) setText(documentKind, '未打开文稿');
    else if (editor.doc.meta.readonly) setText(documentKind, '{format} · 只读预览', { format: editor.doc.meta.source.toUpperCase() });
    else setText(documentKind, editor.doc.meta.source === 'ppt'
      ? pptConversionAccepted ? 'PPT → PPTX · 可编辑' : 'PPT · 转换后可编辑' : 'PPTX · 可编辑');
    const name = `${editor?.isDirty() ? '● ' : ''}${activeName}`;
    fileName.textContent = name;
    setText(document.querySelector('title')!, '{name} · Web-PPT 编辑器', { name });
    viewport.syncSelection(); application?.tools?.sync();
    commentsButton.disabled = !loaded;
    application?.recovery.sync(current?.session ?? null);
  }
  const hideLoading = () => {
    if (signal.aborted) return;
    canvasState.hidden = true; delete app.dataset.loading; syncControls();
  };
  const showOpenFailure = (error: SiteMessage) => {
    if (signal.aborted) return;
    canvasState.hidden = false;
    canvasState.querySelector('.spinner')?.setAttribute('hidden', '');
    setText(canvasState.querySelector('strong')!, '演示文稿打开失败');
    setMessage(canvasState.querySelector('small')!, error);
    delete app.dataset.loading; notice(error, 'error'); syncControls();
  };
  const confirmReplacement = () => !signal.aborted && (!current?.session.editor.isDirty()
    || window.confirm(t('当前修改还没有保存，仍然打开另一份文件吗？')));
  const openDocument: EditorOpenHost['open'] = async (source, name, options, requestSignal) => {
    const owner = application;
    const stale = () => signal.aborted || requestSignal.aborted;
    if (!owner || stale()) return;
    owner.tools?.reset();
    canvasState.hidden = false;
    setMessage(canvasState.querySelector('strong')!, message('正在打开 {name}', { name }));
    setText(canvasState.querySelector('small')!, '解析和渲染完全在浏览器中进行');
    canvasState.querySelector('.spinner')?.removeAttribute('hidden');
    app.dataset.loading = 'true'; syncControls();
    notice(message('正在解析 {name}…', { name }));
    try {
      const prepared = await prepareEditorDocument(source, owner.recovery, requestSignal);
      const next = prepared.session;
      if (stale()) { next.dispose(); return; }
      current = null;
      owner.tools?.bindSession();
      viewport.reset(!next.editor.doc.meta.readonly && next.editor.doc.meta.source !== 'ppt' ? 'edit' : 'view');
      viewport.renderNavigation();
      const mounted = await owner.replace(next, {
        mode: viewport.mode, zoom: 1, snapping: true, onSlideChange: viewport.onSlideChange,
        onTouchNavigate: viewport.onTouchNavigate, onContextRequest: viewport.onContextRequest, onError: reportError,
      }, prepared.modules, requestSignal);
      if (!mounted || stale()) return;
      current = mounted; activeName = name; newDocument = !!options.newDocument; pptConversionAccepted = false;
      owner.tools?.bindSession(); viewport.renderNavigation();
      hideLoading(); viewport.fitOnNextFrame();
      const readyMessage = next.editor.doc.meta.source === 'ppt'
        ? message('{name} 已打开；进入编辑时会先确认另存为 {output}', { name, output: outputName() })
        : next.editor.doc.meta.readonly
          ? message('{name} 已打开；当前文件缺少安全写回上下文，只能预览', { name })
          : message('{name} 已就绪，可直接选择、拖动或双击编辑文字', { name });
      notice(readyMessage, canWriteDocument() ? 'success' : 'normal');
      mounted.view.element.focus();
    } catch (error) {
      if (stale()) return;
      const failure = message('打开失败：{detail}', { detail: error instanceof Error ? error.message : String(error) });
      if (current) { hideLoading(); notice(failure, 'error'); current.view.element.focus(); }
      else showOpenFailure(failure);
    }
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    lifetime.abort();
    // 会话还要完成已提交的文件交付，但 SDK 画布与面板不能继续接收编辑意图。
    canvasMount.inert = objectList.inert = true;
    current?.view.setMode('view'); current?.pane.setMode('view');
    for (const button of Object.values(buttons)) button.disabled = true;
    fileInput.disabled = commentsButton.disabled = slideSizeButton.disabled = true;
  };
  return {
    get current() { return current; }, notice,
    host: {
      canvas: canvasMount, objects: objectList,
      tools: { snapshot: () => ({ session: current?.session ?? null, view: current?.view ?? null,
        fonts: current?.fonts,
        adjustments: current?.adjustments ?? null, name: activeName, writable: ready() && canMutateDocument() && viewport.mode === 'edit' }),
        showSlide: viewport.showSlide, openInspector: viewport.openInspector },
      textTools: [toolbar, document.querySelector<HTMLElement>('#siteLanguage')!, inspectorElement],
      onChange(change) {
        if (signal.aborted) return;
        if (change.createdSlides.size || change.removedSlides.size || change.movedSlides.size) viewport.renderNavigation();
        syncControls(); void application?.recovery.flush(current?.session ?? null);
      },
    },
    fileHost: { buttons, sync: syncControls, snapshot: () => ({ session: current?.session ?? null,
      name: outputName(), writable: !signal.aborted && canMutateDocument(), loading: !!app.dataset.loading,
      showComments: application?.tools?.showComments ?? false }) },
    openHost: { input: fileInput, dropLayer, newFile: buttons.newFile,
      confirmReplacement, open: openDocument, failed: showOpenFailure, cancelled: hideLoading },
    connect(owner) { if (!signal.aborted) { application = owner; syncControls(); } },
    stop,
    release() {
      if (released) return;
      released = true;
      stop(); current = null; application = undefined;
      delete app.dataset.loading; dropLayer.hidden = true;
      canvasMount.replaceChildren(); objectList.replaceChildren(); slideList.replaceChildren();
      canvasMount.inert = objectList.inert = false;
      pageIndicator.textContent = '— / —'; slideCount.textContent = '0'; zoomLabel.textContent = '100%';
      fileName.textContent = '';
      setText(document.querySelector('title')!, '在线 PPT 编辑器 · Web-PPT');
      setText(documentKind, '未打开文稿'); setText(statusText, '未打开文稿'); statusText.dataset.tone = 'normal';
      canvasState.hidden = false; canvasState.querySelector('.spinner')?.setAttribute('hidden', '');
      setText(canvasState.querySelector('strong')!, '未打开文稿'); setMessage(canvasState.querySelector('small')!, '');
    },
  };
}
