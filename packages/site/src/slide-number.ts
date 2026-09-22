/** 官方表没写缓冲能留多久。两秒够连按出页码；再久，下一次用来前进的 Enter 会被旧数字抢走。 */
export const SLIDE_NUMBER_TIMEOUT_MS = 2000;

export const SLIDE_NUMBER_CLASS = 'slide-number';

export interface SlideNumber {
  clear(): void;
  dispose(): void;
}

/**
 * 放映里的页码缓冲。
 *
 * 必须在 blank-screen 之前注册：遮罩里的 Enter 会 stopImmediatePropagation，
 * 排在后面就确认不到合法页码。缓冲为空时这里什么都不拦截，Enter 仍交给
 * 原来的前进、播完动画，或遮罩里的只恢复。
 */
export function bindSlideNumber(options: {
  host: HTMLElement;
  presenting: () => boolean;
  keysActive?: () => boolean;
  viewer: () => { index: number; count: number; goTo(index: number, direction?: 'forward' | 'backward'): void } | null;
  onJump?: () => void;
}): SlideNumber {
  const { host, presenting, keysActive, viewer, onJump } = options;
  const chip = document.createElement('div');
  chip.className = SLIDE_NUMBER_CLASS;
  chip.setAttribute('aria-live', 'polite');
  chip.hidden = true;
  host.append(chip);

  let buffer = '';
  let timer = 0;

  const paint = (): void => {
    const show = buffer.length > 0 && presenting();
    chip.hidden = !show;
    chip.textContent = show ? buffer : '';
  };

  const clear = (): void => {
    window.clearTimeout(timer);
    timer = 0;
    buffer = '';
    paint();
  };

  const pushDigit = (digit: string): void => {
    const current = viewer();
    if (!current || current.count < 1) return;
    // 位数已经顶满再按，是在改口。7 页时不能把 1、2 收成不存在的 12。
    const width = String(current.count).length;
    buffer = buffer.length >= width ? digit : buffer + digit;
    paint();
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { clear(); }, SLIDE_NUMBER_TIMEOUT_MS);
  };

  const confirm = (): void => {
    const typed = buffer;
    const current = viewer();
    clear();
    if (!current) return;
    const page = Number(typed);
    // goTo 会把越界页夹到最后一页。0 和超出总页数必须留在当前页。
    if (!Number.isInteger(page) || page < 1 || page > current.count) return;
    const index = page - 1;
    current.goTo(index, index < current.index ? 'backward' : 'forward');
    onJump?.();
  };

  const armed = (event: KeyboardEvent): boolean => {
    const typing = event.target instanceof Element
      && !!event.target.closest('input,select,textarea,[contenteditable]');
    return presenting() && !typing && !event.isComposing && (!keysActive || keysActive());
  };

  const isDigit = (event: KeyboardEvent): boolean => {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    return event.key.length === 1 && event.key >= '0' && event.key <= '9';
  };

  const onKey = (event: KeyboardEvent): void => {
    if (!armed(event)) {
      if (buffer) clear();
      return;
    }
    if (isDigit(event)) {
      // 按住会把页码打成一长串，也会让查看器的 0 去适应窗口。第一次已经入缓冲。
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) pushDigit(event.key);
      return;
    }
    if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (!buffer) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      confirm();
      return;
    }
    if (buffer) clear();
  };

  const onPointer = (): void => {
    // 点舞台或翻页按钮不是在确认页码。缓冲若还在，下一次 Enter 会跳走。
    if (buffer) clear();
  };

  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onPointer, true);

  return {
    clear,
    dispose(): void {
      clear();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
      chip.remove();
    },
  };
}
