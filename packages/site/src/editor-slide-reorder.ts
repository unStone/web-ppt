import type { EditorSession } from '@web-ppt/editor';
import { setAttributeText } from './i18n/runtime';

interface ReorderContext {
  readonly session: EditorSession | null;
  showSlide(id: string): void;
  onError(error: unknown): void;
}

let draggedSlide: string | null = null;

export function renderSlideNavigation(list: HTMLElement, context: () => ReorderContext): void {
  list.replaceChildren();
  const ids = context().session?.editor.doc.slideOrder ?? [];
  ids.forEach((id, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'slide-item'; button.dataset.slideId = id;
    setAttributeText(button, 'aria-label', '打开第 {index} 页', { index: index + 1 });
    const number = document.createElement('span');
    number.className = 'slide-number'; number.textContent = String(index + 1);
    const mini = document.createElement('span');
    mini.className = 'slide-mini'; mini.textContent = `P${index + 1}`;
    button.append(number, mini);
    button.addEventListener('click', () => context().showSlide(id));
    enableSlideReorder(button, id, context);
    list.append(button);
  });
}

/** DOM 只负责表达拖放意图；稳定页身份与分数序仍由公开 MoveSlide 命令决定。 */
export function enableSlideReorder(
  button: HTMLButtonElement,
  id: string,
  context: () => ReorderContext,
): void {
  button.draggable = true;
  button.addEventListener('dragstart', (event) => {
    draggedSlide = id;
    button.setAttribute('aria-grabbed', 'true');
    event.dataTransfer?.setData('text/x-web-ppt-slide', id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  });
  button.addEventListener('dragend', () => {
    draggedSlide = null;
    button.removeAttribute('aria-grabbed');
    document.querySelectorAll('[data-drop-target]').forEach((node) => node.removeAttribute('data-drop-target'));
  });
  button.addEventListener('dragover', (event) => {
    if (!draggedSlide || draggedSlide === id) return;
    event.preventDefault();
    button.dataset.dropTarget = 'true';
    button.dataset.dropPosition = event.clientY < button.getBoundingClientRect().top + button.offsetHeight / 2
      ? 'before' : 'after';
  });
  button.addEventListener('dragleave', () => {
    button.removeAttribute('data-drop-target'); button.removeAttribute('data-drop-position');
  });
  button.addEventListener('drop', (event) => {
    event.preventDefault();
    const before = button.dataset.dropPosition === 'before';
    button.removeAttribute('data-drop-target'); button.removeAttribute('data-drop-position');
    const { session, showSlide, onError } = context();
    const source = event.dataTransfer?.getData('text/x-web-ppt-slide') || draggedSlide;
    if (!session || !source || source === id) return;
    try {
      const withoutSource = session.editor.doc.slideOrder.filter((candidate) => candidate !== source);
      const targetIndex = withoutSource.indexOf(id);
      const after = before ? withoutSource[targetIndex - 1] ?? null : id;
      session.editor.exec({ type: 'MoveSlide', id: source, at: { after } });
      showSlide(source);
    } catch (error) { onError(error); }
  });
}
