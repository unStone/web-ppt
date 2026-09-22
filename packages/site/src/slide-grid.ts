import type { Viewer } from '@web-ppt/viewer-core';

export const SLIDE_GRID = 'slide-grid';

function chromeCopy(): { title: string; label: string; heading: string; close: string; hidden: string; browse: string } {
  // 不进共享词库：编辑器首包会把 en-home 整表打进去。
  const en = document.documentElement.lang.startsWith('en');
  if (en) {
    return {
      title: 'See all slides (G)',
      label: 'See all slides',
      heading: 'All slides',
      close: 'Close',
      hidden: 'Hidden',
      browse: 'All',
    };
  }
  return {
    title: '全部幻灯片（G）',
    label: '全部幻灯片',
    heading: '全部幻灯片',
    close: '关闭',
    hidden: '隐藏',
    browse: '全部',
  };
}

export interface SlideGrid {
  showing(): boolean;
  open(): boolean;
  close(): void;
  toggle(): void;
  reset(): void;
  syncChrome(): void;
  consumeEscape(): boolean;
  dispose(): void;
}

export function bindSlideGrid(options: {
  viewer: () => Viewer | null;
  thumbsVisible?: () => boolean;
  keysActive?: () => boolean;
  browseButtons?: HTMLButtonElement[];
  presentButtons?: HTMLButtonElement[];
  onJump?: () => void;
}): SlideGrid {
  const {
    viewer, thumbsVisible, keysActive,
    browseButtons = [], presentButtons = [], onJump,
  } = options;
  const buttons = [...browseButtons, ...presentButtons];

  const overlay = document.createElement('div');
  overlay.className = SLIDE_GRID;
  overlay.hidden = true;
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML =
    '<div class="slide-grid-panel">' +
    '<header class="slide-grid-head">' +
    '<strong class="slide-grid-title"></strong>' +
    '<button type="button" class="slide-grid-close"></button>' +
    '</header>' +
    '<div class="slide-grid-list"></div>' +
    '</div>';

  const title = overlay.querySelector<HTMLElement>('.slide-grid-title')!;
  const closeBtn = overlay.querySelector<HTMLButtonElement>('.slide-grid-close')!;
  const list = overlay.querySelector<HTMLElement>('.slide-grid-list')!;

  let open = false;
  let builtFor: Viewer | null = null;
  let observer: IntersectionObserver | null = null;

  const mountTarget = (): HTMLElement => {
    const fs = document.fullscreenElement;
    // documentElement 全屏时 body 后代仍可见；舞台宿主全屏则必须跟进去。
    if (fs instanceof HTMLElement && fs !== document.documentElement) return fs;
    return document.body;
  };

  const placeOverlay = (): void => {
    const parent = mountTarget();
    if (overlay.parentElement !== parent) parent.append(overlay);
  };

  const paintChrome = (): void => {
    const copy = chromeCopy();
    const current = viewer();
    const showBrowse = !!current && !thumbsVisible?.();
    title.textContent = copy.heading;
    closeBtn.textContent = copy.close;
    overlay.setAttribute('aria-label', copy.label);
    for (const btn of browseButtons) {
      btn.hidden = !showBrowse;
      btn.disabled = !current;
      btn.textContent = copy.browse;
      btn.title = copy.title;
      btn.setAttribute('aria-label', copy.label);
      btn.setAttribute('aria-pressed', String(open));
    }
    for (const btn of presentButtons) {
      btn.disabled = !current;
      btn.title = copy.title;
      btn.setAttribute('aria-label', copy.label);
      btn.setAttribute('aria-pressed', String(open));
    }
  };

  const renderItem = (div: HTMLElement): void => {
    const current = viewer();
    if (!current || !div.classList.contains('pending')) return;
    const i = Number(div.dataset.index);
    const slide = current.presentation.slides[i];
    if (!slide) throw new Error(`网格页不存在：index=${i}`);
    const copy = chromeCopy();
    div.classList.remove('pending');
    div.style.aspectRatio = '';
    div.innerHTML = current.renderSlide(i);
    const no = document.createElement('span');
    no.className = 'slide-grid-no';
    no.textContent = String(i + 1);
    div.append(no);
    if (slide.hidden) {
      const badge = document.createElement('span');
      badge.className = 'slide-grid-hidden';
      badge.textContent = copy.hidden;
      div.append(badge);
      div.classList.add('is-hidden');
    }
    if (i === current.index) div.classList.add('is-current');
  };

  const rebuild = (current: Viewer): void => {
    observer?.disconnect();
    list.innerHTML = '';
    const ratio = `${current.presentation.width} / ${current.presentation.height}`;
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const div = entry.target as HTMLElement;
        observer?.unobserve(div);
        renderItem(div);
      }
    }, { root: list, rootMargin: '200px 0px' });

    for (let i = 0; i < current.count; i++) {
      const div = document.createElement('button');
      div.type = 'button';
      div.className = 'slide-grid-item pending';
      div.dataset.index = String(i);
      div.style.aspectRatio = ratio;
      const no = document.createElement('span');
      no.className = 'slide-grid-no';
      no.textContent = String(i + 1);
      div.append(no);
      list.append(div);
    }
    builtFor = current;
  };

  const flushVisible = (): void => {
    if (!open) return;
    const root = list.getBoundingClientRect();
    list.querySelectorAll<HTMLElement>('.slide-grid-item.pending').forEach((el) => {
      const box = el.getBoundingClientRect();
      if (box.height < 8) return;
      if (box.bottom > root.top - 200 && box.top < root.bottom + 200) renderItem(el);
    });
  };

  const resumePending = (): void => {
    if (!open || !observer) return;
    list.querySelectorAll<HTMLElement>('.slide-grid-item.pending').forEach((el) => {
      observer!.observe(el);
    });
    // 打开当下列表刚有高度，IO 可能还没接到；可见格会空着。
    requestAnimationFrame(() => requestAnimationFrame(flushVisible));
  };

  const markCurrent = (current: Viewer): void => {
    list.querySelectorAll<HTMLElement>('.slide-grid-item').forEach((el, i) => {
      el.classList.toggle('is-current', i === current.index);
    });
    const tile = list.children[current.index] as HTMLElement | undefined;
    tile?.scrollIntoView({ block: 'center' });
  };

  const close = (): void => {
    if (!open) return;
    open = false;
    observer?.disconnect();
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.removeAttribute('aria-modal');
    overlay.removeAttribute('role');
    paintChrome();
  };

  const jump = (index: number): void => {
    const current = viewer();
    if (!current) return;
    current.goTo(index, index < current.index ? 'backward' : 'forward');
    onJump?.();
    close();
  };

  const openGrid = (): boolean => {
    const current = viewer();
    if (!current) return false;
    placeOverlay();
    if (builtFor !== current || list.childElementCount !== current.count) rebuild(current);
    open = true;
    overlay.hidden = false;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-hidden', 'false');
    markCurrent(current);
    resumePending();
    paintChrome();
    closeBtn.focus();
    return true;
  };

  const toggle = (): void => {
    if (open) close();
    else openGrid();
  };

  const reset = (): void => {
    close();
    observer?.disconnect();
    observer = null;
    builtFor = null;
    list.innerHTML = '';
    for (const btn of buttons) {
      btn.disabled = true;
      btn.setAttribute('aria-pressed', 'false');
    }
    for (const btn of browseButtons) btn.hidden = true;
  };

  const consumeEscape = (): boolean => {
    if (!open) return false;
    close();
    return true;
  };

  const onOverlayClick = (event: MouseEvent): void => {
    if (event.target === overlay) close();
  };

  const onListClick = (event: MouseEvent): void => {
    const item = event.target instanceof Element
      ? event.target.closest<HTMLElement>('.slide-grid-item')
      : null;
    if (!item || !list.contains(item)) return;
    event.preventDefault();
    event.stopPropagation();
    jump(Number(item.dataset.index));
  };

  const onKey = (event: KeyboardEvent): void => {
    const typing = event.target instanceof Element
      && !!event.target.closest('input,select,textarea,[contenteditable]');
    if (open && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (typing || (keysActive && !keysActive())) return;
    // 单独的 G 才是网格。Ctrl/⌘+G 是查找下一处；开着网格时后面的吞键也不能把这组键吃掉。
    if ((event.key === 'g' || event.key === 'G') && (event.ctrlKey || event.metaKey || event.altKey)) return;
    if (event.key === 'g' || event.key === 'G') {
      if (!viewer()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      toggle();
      return;
    }
    if (!open || event.key === 'Tab') return;
    // 开着网格时舞台快捷键全部停掉，避免人在挑页时页码或黑层自己变。
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  paintChrome();
  overlay.addEventListener('click', onOverlayClick);
  list.addEventListener('click', onListClick);
  closeBtn.addEventListener('click', close);
  for (const btn of buttons) btn.addEventListener('click', toggle);
  const onFullscreen = (): void => { if (open) placeOverlay(); };
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('fullscreenchange', onFullscreen);
  const langWatch = new MutationObserver(() => paintChrome());
  langWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  addEventListener('resize', paintChrome);
  const compact = window.matchMedia('(max-width: 620px)');
  compact.addEventListener('change', paintChrome);

  return {
    showing: () => open,
    open: openGrid,
    close,
    toggle,
    reset,
    syncChrome: paintChrome,
    consumeEscape,
    dispose(): void {
      langWatch.disconnect();
      removeEventListener('resize', paintChrome);
      compact.removeEventListener('change', paintChrome);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('fullscreenchange', onFullscreen);
      overlay.removeEventListener('click', onOverlayClick);
      list.removeEventListener('click', onListClick);
      closeBtn.removeEventListener('click', close);
      for (const btn of buttons) btn.removeEventListener('click', toggle);
      observer?.disconnect();
      overlay.remove();
      open = false;
      builtFor = null;
    },
  };
}
