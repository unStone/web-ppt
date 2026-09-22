import type { Viewer } from '@web-ppt/viewer-core';

/** 约半厘米：再短就是取消，避免把轻点或微抖当成翻页。 */
const THRESHOLD_PX = 48;
/** 超过这个距离的移动不再当成轻点，避免放映里滑完又被 click 再 next 一次。 */
const TAP_SLOP_PX = 12;
/** 水平必须明显大于竖直，否则把轴向锁给页面/备注滚动。 */
const AXIS_RATIO = 1.15;

export function swipeIntent(dx: number, dy: number): 'next' | 'prev' | null {
  if (Math.abs(dx) < THRESHOLD_PX) return null;
  if (Math.abs(dx) < Math.abs(dy) * AXIS_RATIO) return null;
  return dx < 0 ? 'next' : 'prev';
}

function axisOf(dx: number, dy: number): 'h' | 'v' | null {
  const dist = Math.hypot(dx, dy);
  if (dist < TAP_SLOP_PX) return null;
  if (Math.abs(dx) >= Math.abs(dy) * AXIS_RATIO) return 'h';
  if (Math.abs(dy) >= Math.abs(dx) * AXIS_RATIO) return 'v';
  return null;
}

export interface SwipeNav {
  dispose(): void;
}

export function bindSwipeNav(options: {
  host: HTMLElement;
  viewer: () => Viewer | null;
  /** 与点舞台前进共用排除表，避免两套选择器各自漂。 */
  isAdvanceTarget: (target: EventTarget | null) => boolean;
  /** 查看器放大时要留给画布平移；官网没有缩放，可以不传。 */
  allow?: () => boolean;
  afterChange?: () => void;
}): SwipeNav {
  const { host, viewer, isAdvanceTarget, allow, afterChange } = options;
  let startX = 0;
  let startY = 0;
  let pointerId: number | null = null;
  let axis: 'h' | 'v' | null = null;
  let captured = false;
  let ignoreClick = false;
  let ignoreTimer = 0;

  const armIgnoreClick = (): void => {
    // 只挡这一手势冒出的 click。Sticky 会把竖滑之后的下一次轻点也吞掉。
    ignoreClick = true;
    window.clearTimeout(ignoreTimer);
    ignoreTimer = window.setTimeout(() => { ignoreClick = false; }, 50);
  };

  const clear = (): void => {
    if (captured && pointerId !== null) {
      try { host.releasePointerCapture(pointerId); } catch { /* 已经丢了 capture 时不必再抛 */ }
    }
    pointerId = null;
    axis = null;
    captured = false;
  };

  const onDown = (event: PointerEvent): void => {
    if (pointerId !== null) {
      // 第二指落下：取消，避免捏合或双指拖被当成翻页。
      if (event.pointerId !== pointerId) clear();
      return;
    }
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    if (allow && !allow()) return;
    if (!viewer() || !isAdvanceTarget(event.target)) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    axis = null;
    captured = false;
  };

  const onMove = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    axis ??= axisOf(dx, dy);
    if (axis !== 'h' || captured) return;
    // 判定横向之后再 capture：按下立刻 capture 会抢走竖向滚页面。
    try {
      host.setPointerCapture(event.pointerId);
      captured = true;
    } catch {
      captured = false;
    }
  };

  const onUp = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    const intent = axis === 'v' ? null : swipeIntent(dx, dy);
    if (axis === 'h' || intent) armIgnoreClick();
    clear();
    if (!intent) return;
    const current = viewer();
    if (!current) return;
    if (intent === 'next') current.next();
    else current.prev();
    afterChange?.();
  };

  const onCancel = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    if (axis === 'h') armIgnoreClick();
    clear();
  };

  const onLost = (event: PointerEvent): void => {
    // releasePointerCapture 会同步触发；只清跟踪，不要按 (0,0) 误判位移。
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    axis = null;
    captured = false;
  };

  const onClick = (event: MouseEvent): void => {
    if (!ignoreClick) return;
    ignoreClick = false;
    window.clearTimeout(ignoreTimer);
    // 黑层还盖着：这次 click 是取消黑屏，不是滑完误触的翻页。
    if (event.target instanceof Element && event.target.closest('.present-blank')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  host.addEventListener('pointerdown', onDown);
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerup', onUp);
  host.addEventListener('pointercancel', onCancel);
  host.addEventListener('lostpointercapture', onLost);
  host.addEventListener('click', onClick, true);

  return {
    dispose(): void {
      window.clearTimeout(ignoreTimer);
      clear();
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerup', onUp);
      host.removeEventListener('pointercancel', onCancel);
      host.removeEventListener('lostpointercapture', onLost);
      host.removeEventListener('click', onClick, true);
    },
  };
}
