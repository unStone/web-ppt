import type { Viewer } from '@web-ppt/viewer-core';
import { moveLanguageControl } from './i18n/controls';

export const PRESENTING_CLASS = 'is-presenting';

/**
 * Microsoft 网页放映表把 Down / Up 写在前进 / 后退同一格。
 * 浏览页还要靠它们竖向滚动，调用方必须先确认正在放映。
 * 不放进下面的捕获监听：遮罩和网格在捕获阶段先吞键，这里若抢先 next，遮罩下会翻页。
 */
export function presentVerticalStep(event: KeyboardEvent): 'next' | 'prev' | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  if (event.key === 'ArrowDown') return 'next';
  if (event.key === 'ArrowUp') return 'prev';
  return null;
}

/** 官方 Web：过一会儿隐去。只有能方便悬停时才藏，触屏没有 Esc 也看不见退出。 */
const HOVER_FINE = '(hover: hover) and (pointer: fine)';
const HIDE_MS = 2000;

/**
 * 放映里只有「点到幻灯片本身」才该前进。
 * 链接、页内跳转和控制条如果也触发 next，会把一次点击做成两件事。
 */
export function isPresentAdvanceTarget(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  if (!el) return false;
  return !el.closest(
    'a[href],button,input,select,textarea,[data-slide],.present-bar,.fullscreen-language,.link-toast,.preview-bar,.demo-foot,.pv-side,.speaker-aids,.present-blank,.slide-grid',
  );
}

function nextPaint(): Promise<void> {
  return new Promise((res) => {
    let done = false;
    const go = (): void => { if (!done) { done = true; res(); } };
    requestAnimationFrame(() => requestAnimationFrame(go));
    setTimeout(go, 60);
  });
}

export interface PresentMode {
  presenting(): boolean;
  enter(): Promise<void>;
  exit(): void;
  dispose(): void;
}

export function bindPresentMode(options: {
  host: HTMLElement;
  bar: HTMLElement;
  viewer: () => Viewer | null;
  afterChange?: () => void;
  onEnter?: () => void;
  consumeEscape?: () => boolean;
}): PresentMode {
  const { host, bar, viewer, afterChange, onEnter, consumeEscape } = options;
  let generation = 0;
  let restoreLanguage: (() => void) | undefined;
  let barTimer = 0;
  let slot = host.querySelector<HTMLElement>('.fullscreen-language');
  if (!slot) {
    slot = document.createElement('div');
    slot.className = 'fullscreen-language';
    host.append(slot);
  }

  const presenting = (): boolean => host.classList.contains(PRESENTING_CLASS);
  const hoverQuery = window.matchMedia(HOVER_FINE);
  const canAutoHide = (): boolean => hoverQuery.matches;

  const revealBar = (): void => {
    if (!presenting()) return;
    bar.classList.add('show');
    window.clearTimeout(barTimer);
    barTimer = 0;
    if (!canAutoHide()) return;
    barTimer = window.setTimeout(() => {
      if (presenting()) bar.classList.remove('show');
    }, HIDE_MS);
  };

  const hideBar = (): void => {
    window.clearTimeout(barTimer);
    barTimer = 0;
    bar.classList.remove('show');
  };

  const toggleBar = (): void => {
    if (!presenting()) return;
    if (bar.classList.contains('show')) hideBar();
    else revealBar();
  };

  const exit = (): void => {
    generation++;
    const ours = document.fullscreenElement === host;
    if (!presenting() && !ours) return;
    host.classList.remove(PRESENTING_CLASS);
    document.documentElement.classList.remove(PRESENTING_CLASS);
    window.clearTimeout(barTimer);
    barTimer = 0;
    bar.classList.remove('show');
    restoreLanguage?.();
    restoreLanguage = undefined;
    viewer()?.setAnimate(false);
    if (ours) void document.exitFullscreen();
    afterChange?.();
  };

  const enter = async (): Promise<void> => {
    const current = viewer();
    if (!current || presenting()) return;
    const token = ++generation;
    // 先切放映外观，再请求全屏：全屏失败时用户已经在放映里，不会觉得按钮没反应。
    current.setAnimate(true);
    host.classList.add(PRESENTING_CLASS);
    document.documentElement.classList.add(PRESENTING_CLASS);
    restoreLanguage ??= moveLanguageControl(slot);
    onEnter?.();
    afterChange?.();
    revealBar();
    await nextPaint();
    if (token !== generation) return;
    try {
      await host.requestFullscreen();
    } catch {
      // 平台拒绝或未实现全屏时继续页面内放映，不能退回浏览终态。
    }
    if (token !== generation) {
      if (document.fullscreenElement === host) void document.exitFullscreen();
      return;
    }
    afterChange?.();
  };

  const onClick = (event: MouseEvent): void => {
    if (!presenting() || !isPresentAdvanceTarget(event.target)) return;
    viewer()?.next();
    afterChange?.();
  };

  const onKey = (event: KeyboardEvent): void => {
    if (!presenting()) return;
    if (event.key === 'Escape') {
      // 网格先注册不到捕获阶段的前面；不先问它，Esc 会直接离开放映。
      if (consumeEscape?.()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      exit();
      return;
    }
    const typing = event.target instanceof Element
      && !!event.target.closest('input,select,textarea,[contenteditable]');
    if (typing) return;
    if (event.key === 't' || event.key === 'T') {
      // 官方 Web：T 是控制条开关，不是只唤出。
      event.preventDefault();
      event.stopImmediatePropagation();
      toggleBar();
    }
  };

  const onFullscreen = (): void => {
    if (document.fullscreenElement === host) return;
    if (presenting()) exit();
  };

  const onHoverChange = (): void => {
    if (presenting()) revealBar();
  };

  host.addEventListener('click', onClick);
  host.addEventListener('mousemove', revealBar);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('fullscreenchange', onFullscreen);
  hoverQuery.addEventListener('change', onHoverChange);

  return {
    presenting,
    enter,
    exit,
    dispose(): void {
      exit();
      hoverQuery.removeEventListener('change', onHoverChange);
      host.removeEventListener('click', onClick);
      host.removeEventListener('mousemove', revealBar);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('fullscreenchange', onFullscreen);
    },
  };
}
