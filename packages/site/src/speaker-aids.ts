import type { Viewer } from '@web-ppt/viewer-core';
import { ownsViewerKey } from './i18n/controls';
import { setAttributeText, setMessage, setText } from './i18n/runtime';

/** 与 PresentationState.next() 同一条可见页规则，预览一张放映到不了的页会骗人。 */
export function nextVisibleIndex(viewer: Viewer): number | null {
  const slides = viewer.presentation.slides;
  for (let i = viewer.index + 1; i < slides.length; i++) {
    if (!slides[i].hidden) return i;
  }
  return null;
}

export interface SpeakerAids {
  showing(): boolean;
  sync(): void;
  reset(): void;
  toggle(): void;
  dispose(): void;
}

export function bindSpeakerAids(options: {
  host: HTMLElement;
  button: HTMLButtonElement;
  presentButton?: HTMLButtonElement;
  viewer: () => Viewer | null;
  presenting: () => boolean;
  keysActive: () => boolean;
}): SpeakerAids {
  const { host, button, presentButton, viewer, presenting, keysActive } = options;
  let open = false;
  let browseWanted = false;
  let inPresent = false;

  const panel = document.createElement('aside');
  panel.className = 'speaker-aids';
  panel.hidden = true;
  panel.setAttribute('aria-label', '演讲者备注');
  panel.innerHTML =
    '<header class="speaker-aids-head">' +
    '<strong class="speaker-aids-title"></strong>' +
    '<button type="button" class="speaker-aids-close"></button>' +
    '</header>' +
    '<div class="speaker-aids-label speaker-next-caption"></div>' +
    '<div class="speaker-next" hidden></div>' +
    '<p class="speaker-next-empty" hidden></p>' +
    '<div class="speaker-aids-label speaker-notes-caption"></div>' +
    '<div class="speaker-notes"></div>';
  host.append(panel);

  const title = panel.querySelector<HTMLElement>('.speaker-aids-title')!;
  const closeBtn = panel.querySelector<HTMLButtonElement>('.speaker-aids-close')!;
  const nextCaption = panel.querySelector<HTMLElement>('.speaker-next-caption')!;
  const nextBox = panel.querySelector<HTMLElement>('.speaker-next')!;
  const nextEmpty = panel.querySelector<HTMLElement>('.speaker-next-empty')!;
  const notesCaption = panel.querySelector<HTMLElement>('.speaker-notes-caption')!;
  const notesBody = panel.querySelector<HTMLElement>('.speaker-notes')!;

  setText(title, '演讲者备注');
  setText(closeBtn, '关闭');
  setAttributeText(closeBtn, 'title', '关闭');
  setAttributeText(closeBtn, 'aria-label', '关闭');
  setText(nextCaption, '下一页');
  setText(notesCaption, '演讲者备注');
  setText(button, '演讲者备注');
  setAttributeText(button, 'title', '演讲者备注');
  setAttributeText(panel, 'aria-label', '演讲者备注');
  if (presentButton) {
    setAttributeText(presentButton, 'title', '演讲者备注');
    setAttributeText(presentButton, 'aria-label', '演讲者备注');
  }

  const buttons = presentButton ? [button, presentButton] : [button];

  const paintChrome = (): void => {
    const current = viewer();
    panel.hidden = !open;
    host.classList.toggle('has-speaker-aids', open);
    for (const el of buttons) {
      el.disabled = !current;
      el.setAttribute('aria-pressed', String(open));
      el.setAttribute('aria-expanded', String(open));
    }
  };

  const paintContent = (): void => {
    const current = viewer();
    if (!open || !current) return;
    const notes = current.slide.notes;
    // 空状态用 CSS :empty，避免往共享词库加键把编辑器首包撑破
    setMessage(notesBody, notes ?? '');
    const next = nextVisibleIndex(current);
    if (next === null) {
      setMessage(nextBox, '');
      nextBox.hidden = true;
      nextEmpty.hidden = false;
      return;
    }
    nextEmpty.hidden = true;
    nextBox.hidden = false;
    setMessage(nextBox, '');
    nextBox.innerHTML = current.renderSlide(next);
  };

  const applyPresentEdge = (): void => {
    const now = presenting();
    if (now && !inPresent) {
      browseWanted = open;
      open = false;
      inPresent = true;
    } else if (!now && inPresent) {
      inPresent = false;
      open = browseWanted;
    }
  };

  const paint = (): void => {
    applyPresentEdge();
    paintChrome();
    paintContent();
  };

  const toggle = (): void => {
    if (!viewer()) return;
    open = !open;
    if (!presenting()) browseWanted = open;
    paintChrome();
    paintContent();
  };

  const reset = (): void => {
    open = false;
    browseWanted = false;
    inPresent = false;
    setMessage(nextBox, '');
    nextBox.hidden = true;
    nextEmpty.hidden = true;
    panel.hidden = true;
    host.classList.remove('has-speaker-aids');
    // 换文件或加载失败时即使旧 Viewer 还在，也不能让人打开上一份的备注
    for (const el of buttons) {
      el.disabled = true;
      el.setAttribute('aria-pressed', 'false');
      el.setAttribute('aria-expanded', 'false');
    }
  };

  const onKey = (event: KeyboardEvent): void => {
    if (ownsViewerKey(event) || !keysActive()) return;
    if (event.key === 'Escape' && open && !presenting()) {
      event.preventDefault();
      event.stopPropagation();
      open = false;
      browseWanted = false;
      paintChrome();
      return;
    }
    // Google 放映表写 Open speaker notes → s，不是 Toggle。已打开再按保持开着。
    // N 仍是开关。Ctrl/⌘/Alt+S 是保存或菜单，不能在这里截走。
    if (
      presenting()
      && (event.key === 's' || event.key === 'S')
      && !event.ctrlKey && !event.metaKey && !event.altKey
      && !event.isComposing
    ) {
      if (!viewer()) return;
      event.preventDefault();
      if (open) return;
      open = true;
      paintChrome();
      paintContent();
      return;
    }
    if (event.key !== 'n' && event.key !== 'N') return;
    if (!viewer()) return;
    event.preventDefault();
    toggle();
  };

  button.addEventListener('click', toggle);
  presentButton?.addEventListener('click', toggle);
  closeBtn.addEventListener('click', () => {
    open = false;
    if (!presenting()) browseWanted = false;
    paintChrome();
  });
  document.addEventListener('keydown', onKey);

  paintChrome();

  return {
    showing: () => open,
    sync: paint,
    reset,
    toggle,
    dispose(): void {
      reset();
      document.removeEventListener('keydown', onKey);
      panel.remove();
    },
  };
}
