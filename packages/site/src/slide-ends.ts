export interface SlideEnds {
  dispose(): void;
}

/**
 * 放映中回到第一页或最后一页。
 *
 * 必须排在黑屏之前：遮罩若先把 Home / End 收成「只恢复当前页」，
 * 会 stopImmediatePropagation，首尾页就跳不过去。
 * 浏览态什么都不拦截，官网的 Home / End 仍是整页滚动。
 */
export function bindSlideEnds(options: {
  presenting: () => boolean;
  keysActive?: () => boolean;
  viewer: () => { index: number; count: number; goTo(index: number, direction?: 'forward' | 'backward'): void } | null;
  onJump?: () => void;
}): SlideEnds {
  const { presenting, keysActive, viewer, onJump } = options;

  const onKey = (event: KeyboardEvent): void => {
    if (!presenting()) return;
    const typing = event.target instanceof Element
      && !!event.target.closest('input,select,textarea,[contenteditable]');
    if (typing || event.isComposing || (keysActive && !keysActive())) return;
    if (event.key !== 'Home' && event.key !== 'End') return;
    // Alt+Home / Alt+End 是媒体书签。带修饰键的不是放映表上的首尾页。
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // 按住会反复 goTo。第一次已经落到那一页。
    if (event.repeat) return;
    const current = viewer();
    if (!current || current.count < 1) return;
    const index = event.key === 'Home' ? 0 : current.count - 1;
    current.goTo(index, index < current.index ? 'backward' : 'forward');
    // 同页时 goTo 直接返回，遮罩还得揭掉。
    onJump?.();
  };

  document.addEventListener('keydown', onKey, true);
  return {
    dispose(): void {
      document.removeEventListener('keydown', onKey, true);
    },
  };
}
