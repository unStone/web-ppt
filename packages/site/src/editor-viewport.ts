import type { EditorMode, TouchNavigationChange, EditorContextRequest } from '@web-ppt/editor';
import type { EditorDocument } from './editor-document-plugins';
import type { createEditorFeedback } from './editor-feedback';
import { editorButtons as buttons, editorElements } from './editor-elements';
import { renderSlideNavigation } from './editor-slide-reorder';
import { message } from './i18n/message';
import { t } from './i18n/runtime';

interface ViewportContext {
  document: EditorDocument | null;
  ready: boolean;
  writable: boolean;
  conversionRequired: boolean;
  name: string;
  outputName: string;
  acceptConversion(): void;
  sync(): void;
}

/** 视口偏好属于当前应用；监听、观察器和下一帧任务必须一起释放。 */
export function createEditorViewport(context: () => ViewportContext,
  feedback: ReturnType<typeof createEditorFeedback>, signal: AbortSignal) {
  const { app, canvasViewport, slideList, zoomLabel } = editorElements;
  const { notice, reportError, previewAnimations } = feedback;
  let mode: EditorMode = 'edit', zoom = 1, fitWanted = true, frame = 0;
  const live = () => !signal.aborted && context().ready;
  // 文件任务只限制按钮操作；当前视图已发生的触控与窗口尺寸变化仍须同步。
  const visible = () => !signal.aborted && !!context().document;
  const index = () => {
    const current = context().document;
    return current ? current.session.editor.doc.slideOrder.indexOf(current.view.slideId) : -1;
  };
  const syncSelection = () => {
    const selected = context().document?.view.slideId;
    for (const item of slideList.querySelectorAll<HTMLButtonElement>('[data-slide-id]')) {
      item.setAttribute('aria-current', String(item.dataset.slideId === selected));
    }
  };
  const scrollTo = (id: string) => slideList.querySelector<HTMLElement>(`[data-slide-id="${CSS.escape(id)}"]`)
    ?.scrollIntoView({ block: 'nearest' });
  const showSlide = (id: string) => {
    const current = context().document;
    if (!live() || !current?.session.editor.doc.slides[id]) return;
    current.view.setSlide(id); current.pane.setSlide(id);
    context().sync(); scrollTo(id);
  };
  const onSlideChange = (id: string) => {
    const current = context().document;
    if (signal.aborted || !current?.session.editor.doc.slides[id]) return;
    current.pane.setSlide(id); context().sync(); scrollTo(id);
  };
  const renderNavigation = () => {
    renderSlideNavigation(slideList, () => ({ session: context().document?.session ?? null,
      writable: live() && context().writable && !context().conversionRequired && mode === 'edit',
      showSlide, onError: reportError }), signal);
    syncSelection();
  };
  const setMode = (next: EditorMode) => {
    const state = context(), current = state.document;
    if (!live() || !current || next === 'edit' && !state.writable) return;
    if (next === 'edit' && state.conversionRequired) {
      if (!window.confirm(t(
        '{name} 是旧版 .ppt。进入编辑后将另存为 {output}，不会覆盖原文件。未建模的旧格式内容将显示为带原因的框架占位，仅支持移动、缩放等框架级编辑。继续吗？',
        { name: state.name, output: state.outputName },
      ))) {
        state.sync(); notice(message('已取消格式转换，继续以预览模式打开')); return;
      }
      state.acceptConversion();
    }
    mode = next;
    current.view.setMode(next); current.pane.setMode(next);
    state.sync();
    notice(message(next === 'edit' ? '编辑模式：双击文字，拖动或缩放元素' : '预览模式：点击链接并播放动画'));
  };
  const sizeCanvas = () => {
    const current = context().document;
    if (!current) return;
    current.view.element.style.width = `${current.session.editor.doc.meta.width * zoom}px`;
    current.view.element.style.height = `${current.session.editor.doc.meta.height * zoom}px`;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  };
  const applyZoom = (next: number) => {
    if (!visible()) return;
    zoom = Math.min(2.5, Math.max(.15, next));
    context().document!.view.setZoom(zoom); sizeCanvas();
  };
  const fit = () => {
    const current = context().document;
    if (!visible() || !current) return;
    const { width, height } = current.session.editor.doc.meta;
    applyZoom(Math.min(1.5, Math.max(100, canvasViewport.clientWidth - 56) / width,
      Math.max(100, canvasViewport.clientHeight - 56) / height));
  };
  const onTouchNavigate = (change: TouchNavigationChange) => {
    const current = context().document;
    if (!visible() || !current || change.phase === 'cancel') return;
    zoom = change.viewport.zoom; fitWanted = false; sizeCanvas();
    const rect = current.view.element.querySelector<HTMLElement>('[data-ppt-stage]')?.getBoundingClientRect();
    if (rect) {
      canvasViewport.scrollLeft += rect.left - change.viewport.left;
      canvasViewport.scrollTop += rect.top - change.viewport.top;
    }
  };
  const onContextRequest = (request: EditorContextRequest) => {
    if (live()) notice(message(request.targetId ? '已长按选择对象；可用格式面板继续操作' : '已长按画布'));
  };
  const openInspector = () => {
    if (!live()) return;
    app.dataset.inspectorOpen = 'true'; buttons.inspector.setAttribute('aria-expanded', 'true');
  };
  const closeInspector = () => {
    app.dataset.inspectorOpen = 'false'; buttons.inspector.setAttribute('aria-expanded', 'false');
  };
  const cancelFrame = () => { cancelAnimationFrame(frame); frame = 0; };
  const observer = new ResizeObserver(() => { if (fitWanted) fit(); });
  signal.addEventListener('abort', () => { observer.disconnect(); cancelFrame(); closeInspector(); }, { once: true });
  observer.observe(canvasViewport);
  const on = (button: HTMLButtonElement, action: () => void) => button.addEventListener('click', () => {
    if (live()) action();
  }, { signal });
  on(buttons.edit, () => setMode('edit')); on(buttons.view, () => setMode('view'));
  for (const action of ['undo', 'redo'] as const) on(buttons[action], () => {
    const state = context();
    if (!state.writable || state.conversionRequired || mode !== 'edit') return;
    if (state.document?.session.editor[action]()) notice(message(action === 'undo' ? '已撤销上一步' : '已重做上一步'));
    state.sync();
  });
  on(buttons.prev, () => { const id = context().document?.session.editor.doc.slideOrder[index() - 1]; if (id) showSlide(id); });
  on(buttons.next, () => { const id = context().document?.session.editor.doc.slideOrder[index() + 1]; if (id) showSlide(id); });
  on(buttons.play, () => void previewAnimations(context().document?.view ?? null));
  on(buttons.inspector, () => { if (app.dataset.inspectorOpen === 'true') closeInspector(); else openInspector(); });
  on(buttons.zoomOut, () => { fitWanted = false; applyZoom(zoom - .1); });
  on(buttons.zoomIn, () => { fitWanted = false; applyZoom(zoom + .1); });
  on(buttons.fit, () => { fitWanted = true; fit(); });
  return {
    get mode() { return mode; }, index, syncSelection, renderNavigation, showSlide, openInspector,
    onSlideChange, onTouchNavigate, onContextRequest,
    reset(next: EditorMode = 'edit') { cancelFrame(); mode = next; zoom = 1; fitWanted = true; },
    fitOnNextFrame() { cancelFrame(); if (!signal.aborted) frame = requestAnimationFrame(() => { frame = 0; fit(); }); },
  };
}
