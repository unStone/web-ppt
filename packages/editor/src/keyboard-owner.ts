function isNativeControl(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object' || (target as Node).nodeType !== 1) return false;
  return !!(target as Element).closest(
    'button, input, textarea, select, [contenteditable]:not([contenteditable="false"])',
  );
}

/** closed Shadow 会隐藏真实目标；画布只拥有直接发往视图根的键盘事件，全部后代都应让位。 */
export function shouldYieldKeyboardEvent(event: KeyboardEvent): boolean {
  if (event.currentTarget && event.target && event.currentTarget !== event.target) return true;
  const path = event.composedPath();
  return (path.length ? path : [event.target]).some(isNativeControl);
}
