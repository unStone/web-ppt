interface SlideEditorEventHandlers {
  pointerdown: (event: PointerEvent) => void;
  pointermove: (event: PointerEvent) => void;
  pointerup: (event: PointerEvent) => void;
  pointercancel: (event: PointerEvent) => void;
  dblclick: (event: MouseEvent) => void;
  keydown: (event: KeyboardEvent) => void;
  keyup: (event: KeyboardEvent) => void;
  blur: (event: FocusEvent) => void;
  copy: (event: ClipboardEvent) => void;
  cut: (event: ClipboardEvent) => void;
  paste: (event: ClipboardEvent) => void;
}

/** 事件表集中绑定与释放，构造失败和 destroy 共用同一份对称清理。 */
export function bindSlideEditorEvents(
  element: HTMLElement,
  handlers: SlideEditorEventHandlers,
): () => void {
  const entries = Object.entries(handlers) as [keyof SlideEditorEventHandlers, EventListener][];
  for (const [type, handler] of entries) element.addEventListener(type, handler);
  element.addEventListener('lostpointercapture', handlers.pointercancel);
  return () => {
    for (const [type, handler] of entries) element.removeEventListener(type, handler);
    element.removeEventListener('lostpointercapture', handlers.pointercancel);
  };
}
