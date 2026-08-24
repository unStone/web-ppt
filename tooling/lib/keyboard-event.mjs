/** DOM 键盘契约共用真实冒泡/取消语义，避免各能力测试悄悄分叉。 */
export function keyboardEvent(type, key, init = {}) {
  return new KeyboardEvent(type, {
    key, bubbles: true, composed: true, cancelable: true, ...init,
  });
}
