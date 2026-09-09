import type { EditorSession } from '@web-ppt/editor';
import { setAttributeText } from './i18n/runtime';

interface ReorderContext {
  readonly session: EditorSession | null;
  readonly writable?: boolean;
  showSlide(id: string): void;
  onError(error: unknown): void;
}

const renders = new WeakMap<HTMLElement, AbortController>();

/** 导航重建意味着旧拖放意图失效，旧节点也不能借新的上下文继续操作。 */
export function renderSlideNavigation(list: HTMLElement, context: () => ReorderContext, signal?: AbortSignal): void {
  renders.get(list)?.abort();
  list.replaceChildren();
  if (signal?.aborted) return;
  const rendering = new AbortController(), events = { signal: rendering.signal };
  renders.set(list, rendering);
  const abort = () => rendering.abort();
  signal?.addEventListener('abort', abort, { once: true });
  rendering.signal.addEventListener('abort', () => {
    signal?.removeEventListener('abort', abort);
    if (renders.get(list) === rendering) { renders.delete(list); list.replaceChildren(); }
  }, { once: true });
  let dragged: string | null = null;
  const session = context().session;
  const valid = () => !rendering.signal.aborted && context().session === session && !!session && !session.disposed;
  const writable = () => valid() && context().writable !== false;
  const clear = () => {
    dragged = null;
    for (const node of list.querySelectorAll('[data-drop-target],[aria-grabbed]')) {
      node.removeAttribute('data-drop-target'); node.removeAttribute('data-drop-position'); node.removeAttribute('aria-grabbed');
    }
  };
  (session?.editor.doc.slideOrder ?? []).forEach((id, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'slide-item'; button.dataset.slideId = id;
    setAttributeText(button, 'aria-label', '打开第 {index} 页', { index: index + 1 });
    const number = document.createElement('span');
    number.className = 'slide-number'; number.textContent = String(index + 1);
    const mini = document.createElement('span');
    mini.className = 'slide-mini'; mini.textContent = `P${index + 1}`;
    button.append(number, mini);
    button.addEventListener('click', () => { if (valid()) context().showSlide(id); }, events);
    button.draggable = true;
    button.addEventListener('dragstart', event => {
      if (!writable()) { event.preventDefault(); return; }
      dragged = id;
      button.setAttribute('aria-grabbed', 'true');
      event.dataTransfer?.setData('text/x-web-ppt-slide', id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    }, events);
    button.addEventListener('dragend', clear, events);
    button.addEventListener('dragover', event => {
      if (!writable() || !dragged || dragged === id) return;
      event.preventDefault();
      button.dataset.dropTarget = 'true';
      button.dataset.dropPosition = event.clientY < button.getBoundingClientRect().top + button.offsetHeight / 2 ? 'before' : 'after';
    }, events);
    button.addEventListener('dragleave', () => {
      button.removeAttribute('data-drop-target'); button.removeAttribute('data-drop-position');
    }, events);
    button.addEventListener('drop', event => {
      event.preventDefault();
      const before = button.dataset.dropPosition === 'before';
      const started = dragged;
      const source = event.dataTransfer?.getData('text/x-web-ppt-slide') || dragged;
      clear();
      if (!writable() || !started || !source || source === id) return;
      try {
        if (source !== started) throw new Error(`拖页来源与当前拖放意图不符：${source}`);
        const withoutSource = session!.editor.doc.slideOrder.filter(candidate => candidate !== source);
        const targetIndex = withoutSource.indexOf(id);
        session!.editor.exec({ type: 'MoveSlide', id: source, at: { after: before ? withoutSource[targetIndex - 1] ?? null : id } });
        context().showSlide(source);
      } catch (error) { context().onError(error); }
    }, events);
    list.append(button);
  });
}
