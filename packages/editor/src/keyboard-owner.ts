function isNativeControl(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object' || (target as Node).nodeType !== 1) return false;
  return !!(target as Element).closest(
    'button, input, textarea, select, [contenteditable]:not([contenteditable="false"])',
  );
}

/** composedPath 保留开放 Shadow DOM 内的真实输入目标，event.target 会被重定向到宿主。 */
export function nativeControlOwnsKeyboard(event: KeyboardEvent): boolean {
  const path = event.composedPath();
  return (path.length ? path : [event.target]).some(isNativeControl);
}
