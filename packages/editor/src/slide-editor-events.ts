interface SlideEditorEventHandlers {
  pointerdown: (event: PointerEvent) => void;
  pointermove: (event: PointerEvent) => void;
  pointerup: (event: PointerEvent) => void;
  pointercancel: (event: PointerEvent) => void;
  click: (event: MouseEvent) => void;
  dblclick: (event: MouseEvent) => void;
  keydown: (event: KeyboardEvent) => void;
  keyup: (event: KeyboardEvent) => void;
  blur: (event: FocusEvent) => void;
  copy: (event: ClipboardEvent) => void;
  cut: (event: ClipboardEvent) => void;
  paste: (event: ClipboardEvent) => void;
}

/** 事件表集中绑定与释放，构造失败和 destroy 共用同一份对称清理。 */
export function bindSlideEditorEditEvents(
  element: HTMLElement,
  handlers: SlideEditorEventHandlers,
): () => void {
  const entries = Object.entries(handlers) as [string, EventListener][];
  entries.push(['lostpointercapture', handlers.pointercancel as EventListener]);
  for (const [type, handler] of entries) {
    element.addEventListener(type, handler, type === 'click');
  }
  return () => {
    for (const [type, handler] of entries) {
      element.removeEventListener(type, handler, type === 'click');
    }
  };
}

export function bindSlideEditorLinkEvent(
  element: HTMLElement,
  handlers: {
    click: (event: MouseEvent) => void;
    keydown: (event: KeyboardEvent) => void;
  },
): () => void {
  element.addEventListener('click', handlers.click);
  element.addEventListener('keydown', handlers.keydown);
  return () => {
    element.removeEventListener('click', handlers.click);
    element.removeEventListener('keydown', handlers.keydown);
  };
}
