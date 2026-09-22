import { presentRewindKey } from './present-back-key';

export const BLANK_LAYER = 'present-blank';

/**
 * 遮罩里这些键只恢复当前页，避免看不见的时候悄悄翻页。
 * Home / End 不在这里：它们要跳到首尾页，由 slide-ends 在本监听之前处理。
 */
const RESTORE_KEYS = new Set([
  ' ', 'Enter', 'ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp',
  'PageDown', 'PageUp',
]);

type Veil = 'black' | 'white';

export interface BlankScreen {
  blanked(): boolean;
  set(on: boolean): void;
  toggle(): void;
  clear(): void;
  attach(): void;
  dispose(): void;
}

function english(): boolean {
  return document.documentElement.lang.startsWith('en');
}

function chromeCopy(on: boolean): { title: string; label: string } {
  // 不进共享词库：编辑器首包会把 en-home 整表打进去。
  if (on) {
    return english()
      ? { title: 'Show slide (B or .)', label: 'Show slide' }
      : { title: '取消黑屏（B 或 .）', label: '取消黑屏' };
  }
  return english()
    ? { title: 'Black screen (B or .)', label: 'Black screen' }
    : { title: '黑屏（B 或 .）', label: '黑屏' };
}

/**
 * B 与句号开关黑屏。
 * macOS 放映表里 ⌘+. 是结束放映，带修饰键的句号不能在这里黑屏。
 */
function isBlackToggle(event: KeyboardEvent): boolean {
  if (event.key === 'b' || event.key === 'B') return true;
  if (event.key !== '.') return false;
  return !event.ctrlKey && !event.metaKey && !event.altKey;
}

/**
 * W 与逗号开关白屏。⌘+W / Ctrl+W 是关标签页，修饰键不能进这里，也不能 preventDefault。
 * 认的是字符：美式键盘 Shift+逗号打出来的是 <，那不是表里的 Comma。
 */
function isWhiteToggle(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key === 'w' || event.key === 'W') return true;
  return event.key === ',';
}

export function bindBlankScreen(options: {
  stage: HTMLElement;
  presenting: () => boolean;
  keysActive?: () => boolean;
  button?: HTMLButtonElement | null;
}): BlankScreen {
  const { stage, presenting, keysActive, button } = options;
  const layer = document.createElement('div');
  layer.className = BLANK_LAYER;
  layer.setAttribute('role', 'button');
  layer.tabIndex = -1;

  let veil: Veil | null = null;
  let swallowClick = false;
  let swallowTimer = 0;

  const attach = (): void => {
    if (layer.parentElement !== stage) stage.append(layer);
  };

  const stop = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  const armSwallowClick = (): void => {
    // pointerup 先把层关掉后，浏览器会把随后的 click 打到下面的幻灯片。
    swallowClick = true;
    window.clearTimeout(swallowTimer);
    swallowTimer = window.setTimeout(() => { swallowClick = false; }, 50);
  };

  const paintLayer = (): void => {
    const copy = chromeCopy(veil === 'black');
    layer.classList.toggle('is-on', veil !== null);
    layer.classList.toggle('is-white', veil === 'white');
    layer.setAttribute('aria-label', veil === 'white'
      ? (english() ? 'Show slide' : '取消白屏')
      : copy.label);
    if (button) {
      button.setAttribute('aria-pressed', String(veil === 'black'));
      button.title = copy.title;
      button.setAttribute('aria-label', copy.label);
    }
  };

  const apply = (next: Veil | null): void => {
    const want = next && presenting() ? next : null;
    if (want) {
      attach();
      // 新开遮罩时丢掉上一手势残留，否则随后的 click 会被当成 pointerup 的尾巴
      swallowClick = false;
    }
    veil = want;
    paintLayer();
  };

  const set = (next: boolean): void => { apply(next ? 'black' : null); };
  const clear = (): void => { apply(null); };
  // 按钮只负责黑屏。白的时候按它是换成黑，不是把遮罩直接拿掉。
  const toggle = (): void => { apply(veil === 'black' ? null : 'black'); };
  const toggleWhite = (): void => { apply(veil === 'white' ? null : 'white'); };

  const dismiss = (event: Event): void => {
    if (!veil) {
      // 遮罩已被 pointerup 关掉，尾巴 click 还打在层或底下的幻灯片上。
      if (event.type === 'click' && swallowClick) {
        swallowClick = false;
        stop(event);
      }
      return;
    }
    // 层还盖着：这次就是回到当前页。不能被上一手势的 swallow 挡掉。
    swallowClick = false;
    stop(event);
    apply(null);
    if (event.type === 'pointerup') armSwallowClick();
  };

  const onDocClick = (event: Event): void => {
    if (!swallowClick || veil) return;
    swallowClick = false;
    stop(event);
  };

  const onKey = (event: KeyboardEvent): void => {
    const typing = event.target instanceof Element
      && !!event.target.closest('input,select,textarea,[contenteditable]');
    if (typing || event.isComposing || (keysActive && !keysActive())) return;
    if (!presenting()) {
      if (veil) apply(null);
      return;
    }
    if (isBlackToggle(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toggle();
      return;
    }
    if (isWhiteToggle(event)) {
      // 按住会反复开关，画面闪。第一次已经切换，重复的键丢掉且不拦截。
      if (event.repeat) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      toggleWhite();
      return;
    }
    // 退格、裸 P 与方向键同一条：遮罩里只揭开。谓词排除修饰键，避免 Ctrl+Backspace 或 Ctrl+P 把遮罩揭掉。
    if (!veil || (!RESTORE_KEYS.has(event.key) && !presentRewindKey(event))) return;
    // 焦点常停在「演示」或控制条按钮上；ownsViewerKey 会把空格让给按钮，
    // 遮罩里就会变成翻页且仍盖着。
    event.preventDefault();
    event.stopImmediatePropagation();
    apply(null);
  };

  attach();
  paintLayer();
  layer.addEventListener('click', dismiss);
  layer.addEventListener('pointerup', dismiss);
  button?.addEventListener('click', toggle);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('click', onDocClick, true);
  const langWatch = new MutationObserver(() => paintLayer());
  langWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  // Viewer.paint() 会 innerHTML 清空舞台；盖着的时候必须把同一层座回去。
  const seatWatch = new MutationObserver(() => { if (veil) attach(); });
  seatWatch.observe(stage, { childList: true });

  return {
    blanked: () => veil !== null,
    set,
    toggle,
    clear,
    attach,
    dispose(): void {
      langWatch.disconnect();
      seatWatch.disconnect();
      window.clearTimeout(swallowTimer);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('click', onDocClick, true);
      layer.removeEventListener('click', dismiss);
      layer.removeEventListener('pointerup', dismiss);
      button?.removeEventListener('click', toggle);
      layer.remove();
      veil = null;
      swallowClick = false;
    },
  };
}
