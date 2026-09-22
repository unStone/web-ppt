/**
 * 网页放映表里，除方向键和翻页键以外，调用已有 prev() 的键。
 *
 * Backspace：Windows 的退格，以及 Mac 键盘上标着 delete、删光标前一个字的那颗。
 * 浏览器里这两颗的 `key` 都是 Backspace。`key === "Delete"` 是向前删除，不在后退行。
 *
 * P：同一后退行。Windows 和 Mac 都写裸 P。Caps Lock 时 `key` 是 P，`shiftKey` 仍为假，仍算这颗字母。
 * Ctrl / ⌘+P 在桌面表是画笔，在 Google 网页表是打印；Alt+P 在 Windows 是播放媒体。
 * 带修饰键必须放过，也不能 preventDefault。
 */
function modifiedRewind(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing;
}

export function presentBackKey(event: KeyboardEvent): boolean {
  if (modifiedRewind(event)) return false;
  return event.key === 'Backspace';
}

export function presentPrevLetter(event: KeyboardEvent): boolean {
  if (modifiedRewind(event)) return false;
  return event.key === 'p' || event.key === 'P';
}

export function presentRewindKey(event: KeyboardEvent): boolean {
  return presentBackKey(event) || presentPrevLetter(event);
}
