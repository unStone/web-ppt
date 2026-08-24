function isNativeControl(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object' || (target as Node).nodeType !== 1) return false;
  return !!(target as Element).closest(
    'button, input, textarea, select, [contenteditable]:not([contenteditable="false"])',
  );
}

function eventHasNativeControl(event: Event): boolean {
  const path = event.composedPath();
  return (path.length ? path : [event.target]).some(isNativeControl);
}

/** closed Shadow 会隐藏真实目标；画布只拥有直接发往视图根的键盘事件，全部后代都应让位。 */
export function shouldYieldKeyboardEvent(event: KeyboardEvent): boolean {
  if (event.currentTarget && event.target && event.currentTarget !== event.target) return true;
  return eventHasNativeControl(event);
}

/** SVG 舞台属于画布；closed Shadow 隐藏内部表单时用焦点重定向识别宿主。 */
export function shouldYieldClipboardEvent(event: ClipboardEvent): boolean {
  if (eventHasNativeControl(event)) return true;
  if (!event.currentTarget || !event.target || event.currentTarget === event.target) return false;
  const target = event.target as Element;
  if (target.closest?.('[data-ppt-stage]')) return false;
  // closed Shadow 的 composedPath 看不到内部 input，但焦点会重定向到 host。
  return target.matches?.(':focus, :focus-within') ?? false;
}
