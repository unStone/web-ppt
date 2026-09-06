import { setText } from './i18n/runtime';

/** 定时器和异步剪贴板结果都属于本次点击，关闭预览不能把旧结果带到下一次打开。 */
export function bindCopyButton(button: HTMLButtonElement, value: () => string, idle: '复制' | '复制链接'): () => void {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reset = (): void => {
    generation++;
    clearTimeout(timer);
    button.classList.remove('done');
    setText(button, idle);
  };
  button.addEventListener('click', async () => {
    reset();
    const current = generation;
    try {
      await navigator.clipboard.writeText(value());
      if (current !== generation) return;
      setText(button, '已复制');
      button.classList.add('done');
    } catch {
      if (current !== generation) return;
      setText(button, '复制失败');
    }
    timer = setTimeout(reset, 1400);
  });
  reset();
  return reset;
}
