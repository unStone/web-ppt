/**
 * 文稿没了就不能再展示上一份备注。
 * 官网辅助层换文件已经 reset；独立查看器以前只拆 Viewer，面板和正文还在。
 */

export function resetViewerNotes(
  panel: HTMLElement,
  body: HTMLElement,
  button: HTMLButtonElement,
): void {
  panel.hidden = true;
  body.textContent = '';
  button.classList.remove('active');
  button.disabled = true;
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-expanded', 'false');
}

export function setViewerNotesOpen(
  panel: HTMLElement,
  button: HTMLButtonElement,
  open: boolean,
): void {
  if (button.disabled && open) {
    throw new Error('未打开文稿时不能打开备注面板');
  }
  panel.hidden = !open;
  button.classList.toggle('active', open);
  button.setAttribute('aria-pressed', String(open));
  button.setAttribute('aria-expanded', String(open));
}

export function enableViewerNotes(button: HTMLButtonElement): void {
  button.disabled = false;
}
