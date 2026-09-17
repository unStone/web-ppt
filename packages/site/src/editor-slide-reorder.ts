import { renderSlideToSvg } from '@web-ppt/core';
import type { EditorSession } from '@web-ppt/editor';
import { setAttributeText, setText } from './i18n/runtime';

interface ReorderContext {
  readonly session: EditorSession | null;
  readonly writable?: boolean;
  showSlide(id: string): void;
  onError(error: unknown): void;
}

interface Thumbnail {
  readonly id: string;
  readonly mini: HTMLElement;
  readonly retry: HTMLButtonElement;
  visible: boolean;
  rendered: boolean;
  frame: number;
}

interface NavigationRender {
  readonly controller: AbortController;
  readonly session: EditorSession;
  readonly thumbnails: Map<string, Thumbnail>;
  refresh(ids: Iterable<string>): void;
}

const renders = new WeakMap<HTMLElement, NavigationRender>();

/** 邻近视区时再生成缩略图。 */
export function renderSlideNavigation(list: HTMLElement, context: () => ReorderContext, signal?: AbortSignal): void {
  renders.get(list)?.controller.abort();
  list.replaceChildren();
  if (signal?.aborted) return;
  const session = context().session;
  if (!session || session.disposed) return;
  const controller = new AbortController(), events = { signal: controller.signal };
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const presentation = session.toPresentation();
  // 复用页面级字体，避免每页重复内联。
  presentation.embeddedFonts = undefined;
  const thumbnails = new Map<string, Thumbnail>();
  const valid = () => !controller.signal.aborted && context().session === session && !session.disposed;
  const writable = () => valid() && context().writable !== false;
  const renderThumbnail = (thumbnail: Thumbnail) => {
    if (!valid() || thumbnail.rendered || !session.editor.doc.slides[thumbnail.id]) return;
    thumbnail.rendered = true; thumbnail.frame = 0;
    const index = session.editor.doc.slideOrder.indexOf(thumbnail.id);
    if (index < 0) return;
    try {
      const slide = session.editor.toSlide(thumbnail.id);
      presentation.width = session.editor.doc.meta.width;
      presentation.height = session.editor.doc.meta.height;
      presentation.slides[index] = slide;
      thumbnail.mini.innerHTML = renderSlideToSvg(presentation, slide, {
        textMode: 'svg', idPrefix: `${session.editor.doc.identity.prefix}thumbnail-${thumbnail.id}-`,
      });
      thumbnail.mini.dataset.state = 'ready'; thumbnail.mini.removeAttribute('aria-busy');
      thumbnail.retry.hidden = true;
    } catch (error) {
      thumbnail.mini.replaceChildren(); thumbnail.mini.dataset.state = 'error';
      thumbnail.mini.removeAttribute('aria-busy');
      const icon = document.createElement('i'); icon.dataset.lucide = 'triangle-alert';
      const label = document.createElement('span'); setText(label, '预览生成失败');
      thumbnail.mini.append(icon, label);
      thumbnail.retry.hidden = false;
      context().onError(error);
    }
  };
  const schedule = (thumbnail: Thumbnail) => {
    if (!thumbnail.visible || thumbnail.rendered || thumbnail.frame || !valid()) return;
    thumbnail.frame = requestAnimationFrame(() => renderThumbnail(thumbnail));
  };
  const reset = (thumbnail: Thumbnail) => {
    cancelAnimationFrame(thumbnail.frame); thumbnail.frame = 0; thumbnail.rendered = false;
    thumbnail.mini.replaceChildren(); thumbnail.mini.dataset.state = 'loading';
    thumbnail.mini.setAttribute('aria-busy', 'true'); thumbnail.retry.hidden = true;
    const skeleton = document.createElement('span'); skeleton.className = 'slide-mini-skeleton';
    thumbnail.mini.append(skeleton); schedule(thumbnail);
  };
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const id = (entry.target as HTMLElement).dataset.thumbnailId!;
      const thumbnail = thumbnails.get(id);
      if (!thumbnail) continue;
      thumbnail.visible = entry.isIntersecting;
      if (entry.isIntersecting) schedule(thumbnail);
    }
  }, { root: list, rootMargin: '240px 0px' });
  controller.signal.addEventListener('abort', () => {
    observer.disconnect(); signal?.removeEventListener('abort', abort);
    for (const thumbnail of thumbnails.values()) cancelAnimationFrame(thumbnail.frame);
    if (renders.get(list)?.controller === controller) { renders.delete(list); list.replaceChildren(); }
  }, { once: true });

  let dragged: string | null = null;
  const clear = () => {
    dragged = null;
    for (const node of list.querySelectorAll('[data-drop-target],[aria-grabbed]')) {
      node.removeAttribute('data-drop-target'); node.removeAttribute('data-drop-position'); node.removeAttribute('aria-grabbed');
    }
  };
  session.editor.doc.slideOrder.forEach((id, index) => {
    const shell = document.createElement('div');
    shell.className = 'slide-item-shell'; shell.draggable = true; shell.dataset.slideId = id;
    setAttributeText(shell, 'aria-label', '打开第 {index} 页', { index: index + 1 });
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'slide-item';
    setAttributeText(button, 'aria-label', '打开第 {index} 页', { index: index + 1 });
    const number = document.createElement('span');
    number.className = 'slide-number'; number.textContent = String(index + 1);
    const drag = document.createElement('i'); drag.className = 'slide-drag'; drag.dataset.lucide = 'grip-vertical';
    const mini = document.createElement('span');
    mini.className = 'slide-mini'; mini.dataset.thumbnailId = id;
    mini.setAttribute('aria-hidden', 'true');
    mini.style.aspectRatio = `${session.editor.doc.meta.width} / ${session.editor.doc.meta.height}`;
    const retry = document.createElement('button');
    retry.type = 'button'; retry.className = 'slide-preview-retry'; retry.hidden = true;
    setAttributeText(retry, 'aria-label', '重试生成第 {index} 页预览', { index: index + 1 });
    const retryIcon = document.createElement('i'); retryIcon.dataset.lucide = 'refresh-cw'; retry.append(retryIcon);
    button.append(number, mini, drag); shell.append(button, retry); list.append(shell);
    const thumbnail: Thumbnail = { id, mini, retry, visible: false, rendered: false, frame: 0 };
    thumbnails.set(id, thumbnail); reset(thumbnail); observer.observe(mini);
    retry.addEventListener('click', () => { thumbnail.visible = true; reset(thumbnail); }, events);
    button.addEventListener('click', () => { if (valid()) context().showSlide(id); }, events);
    shell.addEventListener('dragstart', event => {
      if (!writable()) { event.preventDefault(); return; }
      dragged = id; shell.setAttribute('aria-grabbed', 'true');
      event.dataTransfer?.setData('text/x-web-ppt-slide', id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    }, events);
    shell.addEventListener('dragend', clear, events);
    shell.addEventListener('dragover', event => {
      if (!writable() || !dragged || dragged === id) return;
      event.preventDefault(); shell.dataset.dropTarget = 'true';
      shell.dataset.dropPosition = event.clientY < shell.getBoundingClientRect().top + shell.offsetHeight / 2 ? 'before' : 'after';
    }, events);
    shell.addEventListener('dragleave', () => {
      shell.removeAttribute('data-drop-target'); shell.removeAttribute('data-drop-position');
    }, events);
    shell.addEventListener('drop', event => {
      event.preventDefault();
      const before = shell.dataset.dropPosition === 'before';
      const started = dragged;
      const source = event.dataTransfer?.getData('text/x-web-ppt-slide') || dragged;
      clear();
      if (!writable() || !started || !source || source === id) return;
      try {
        if (source !== started) throw new Error(`拖页来源与当前拖放意图不符：${source}`);
        const withoutSource = session.editor.doc.slideOrder.filter(candidate => candidate !== source);
        const targetIndex = withoutSource.indexOf(id);
        session.editor.exec({ type: 'MoveSlide', id: source,
          at: { after: before ? withoutSource[targetIndex - 1] ?? null : id } });
        context().showSlide(source);
      } catch (error) { context().onError(error); }
    }, events);
  });
  const state: NavigationRender = {
    controller, session, thumbnails,
    refresh(ids) { if (valid()) for (const id of ids) { const thumbnail = thumbnails.get(id); if (thumbnail) reset(thumbnail); } },
  };
  renders.set(list, state);
}

export function refreshSlideThumbnails(list: HTMLElement, ids: Iterable<string>): void {
  renders.get(list)?.refresh(ids);
}
