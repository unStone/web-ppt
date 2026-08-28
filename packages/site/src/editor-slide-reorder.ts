import type { EditorSession } from '@web-ppt/editor';

interface ReorderContext {
  readonly session: EditorSession | null;
  showSlide(id: string): void;
  onError(error: unknown): void;
}

let draggedSlide: string | null = null;

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
