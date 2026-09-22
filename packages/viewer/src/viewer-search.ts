import { slideText, type Presentation, type Slide } from '@web-ppt/core';
import type { Viewer } from '@web-ppt/viewer-core';
import { enableViewerSearch, resetViewerSearch } from './open-file-info';
import {
  applySearchHighlight,
  clearSearchHighlight,
  collectSearchRanges,
  isSearchRootVisible,
} from './viewer-search-highlight';

export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export async function searchSlidesIncrementally(options: {
  slides: ArrayLike<Slide> & { length: number };
  query: string;
  cache: Map<number, string>;
  isCurrent: () => boolean;
  onHit: (index: number) => void;
  onProgress?: (scanned: number, total: number) => void;
  deadlineMs?: number;
  now?: () => number;
  yieldToMain?: () => Promise<void>;
}): Promise<'done' | 'cancelled'> {
  const query = options.query.trim().toLowerCase();
  if (!query) {
    throw new Error('空查询不能扫描后页');
  }
  const deadline = options.deadlineMs ?? 50;
  if (!Number.isFinite(deadline) || deadline < 0) {
    throw new Error(`查找让出时限无效：${deadline}`);
  }
  const now = options.now ?? (() => performance.now());
  const yieldFn = options.yieldToMain ?? yieldToMain;
  const total = options.slides.length;
  let lastYield = now();
  for (let i = 0; i < total; i++) {
    if (!options.isCurrent()) return 'cancelled';
    let text = options.cache.get(i);
    if (text === undefined) {
      text = slideText(options.slides[i]);
      options.cache.set(i, text);
    }
    if (text.toLowerCase().includes(query)) options.onHit(i);
    if (now() - lastYield > deadline) {
      options.onProgress?.(i + 1, total);
      await yieldFn();
      lastYield = now();
    }
  }
  return options.isCurrent() ? 'done' : 'cancelled';
}

export function bindViewerSearch(options: {
  query: HTMLInputElement;
  hitsLabel: HTMLElement;
  thumbs: HTMLElement;
  highlightRoots: () => readonly ParentNode[];
  presentation: () => Presentation | null;
  viewer: () => Viewer | null;
  presenting: () => boolean;
  onJump: () => void;
}): {
  reset: () => void;
  enable: () => void;
  run: () => Promise<void>;
  nextOrRun: () => Promise<void>;
  previous: () => Promise<void>;
  /** 浏览态的 Find again。不能接时返回 false，调用方不要拦截按键。 */
  findAgain: (delta: 1 | -1) => boolean;
  syncHighlight: () => void;
  focusIfAllowed: () => boolean;
} {
  const { query, hitsLabel, thumbs } = options;
  let generation = 0;
  const cache = new Map<number, string>();
  const hits: number[] = [];
  let jumped = false;
  let debounce = 0;
  let occurrence = 0;
  let paintedPage = -1;
  let keepOccurrence = false;
  let applied = '';

  const clearMarks = (): void => {
    thumbs.querySelectorAll('.thumb.hit').forEach((thumb) => thumb.classList.remove('hit'));
  };

  const visibleRoots = (): ParentNode[] => options.highlightRoots().filter(isSearchRootVisible);

  const visibleCount = (q: string): number => (
    visibleRoots().reduce((sum, root) => sum + collectSearchRanges(root, q).length, 0)
  );

  const writePageLabel = (count: number, onHit: boolean): void => {
    if (hitsLabel.textContent.startsWith('查找中')) return;
    const pages = `${hits.length} 页`;
    hitsLabel.textContent = onHit && count > 1
      ? `${pages} · 第 ${occurrence + 1}/${count} 处`
      : pages;
  };

  const paintHighlight = (): void => {
    const q = query.value.trim();
    const index = options.viewer()?.index;
    const show = Boolean(q) && !query.disabled && !options.presenting() && index != null && hits.includes(index);
    if (!show || index == null) {
      clearSearchHighlight();
      if (hits.length) writePageLabel(0, false);
      return;
    }
    if (!keepOccurrence && index !== paintedPage) occurrence = 0;
    keepOccurrence = false;
    paintedPage = index;
    const count = visibleCount(q);
    if (count === 0) {
      clearSearchHighlight();
      writePageLabel(0, false);
      return;
    }
    if (occurrence < 0 || occurrence >= count) occurrence = count - 1;
    applySearchHighlight(visibleRoots(), q, occurrence);
    writePageLabel(count, true);
  };

  const resetHits = (): void => {
    hits.length = 0;
    jumped = false;
    occurrence = 0;
    paintedPage = -1;
    keepOccurrence = false;
    applied = '';
    clearMarks();
    hitsLabel.textContent = '';
    paintHighlight();
  };

  const jumpTo = (index: number, direction: 'forward' | 'backward' = 'forward'): void => {
    options.viewer()?.goTo(index, direction);
    options.onJump();
  };

  const neighbor = (delta: 1 | -1, index: number): number => {
    if (delta > 0) return hits.find((i) => i > index) ?? hits[0];
    for (let i = hits.length - 1; i >= 0; i--) {
      if (hits[i] < index) return hits[i];
    }
    return hits[hits.length - 1];
  };

  // 官方 Find Next 按「下一次出现」走。本页还有词就留在本页；只剩一处时，下一次本来就在下一页。
  const stepOccurrence = (delta: 1 | -1): void => {
    const q = query.value.trim();
    const index = options.viewer()?.index;
    if (!q || index == null || !hits.length) return;
    const count = hits.includes(index) ? visibleCount(q) : 0;
    const next = occurrence + delta;
    if (count > 0 && next >= 0 && next < count) {
      occurrence = next;
      keepOccurrence = true;
      options.onJump();
      paintHighlight();
      return;
    }
    const target = neighbor(delta, index);
    occurrence = delta > 0 ? 0 : -1;
    keepOccurrence = true;
    jumpTo(target, delta > 0 ? 'forward' : 'backward');
    paintHighlight();
  };

  const run = async (): Promise<void> => {
    const token = ++generation;
    const pres = options.presentation();
    const q = query.value.trim();
    resetHits();
    if (!q || !pres || query.disabled) return;
    const result = await searchSlidesIncrementally({
      slides: pres.slides,
      query: q,
      cache,
      isCurrent: () => token === generation,
      onHit(index) {
        hits.push(index);
        thumbs.children[index]?.classList.add('hit');
        if (!jumped) {
          jumped = true;
          jumpTo(index);
        }
      },
      onProgress(scanned, total) {
        if (token === generation) hitsLabel.textContent = `查找中 · ${scanned}/${total}`;
      },
    });
    if (token !== generation || result === 'cancelled') return;
    applied = q.toLowerCase();
    hitsLabel.textContent = hits.length ? `${hits.length} 页` : '无结果';
    paintHighlight();
  };

  const schedule = (): void => {
    clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      void run();
    }, 250);
  };

  query.addEventListener('input', schedule);
  query.addEventListener('keydown', (event) => {
    // 组字确认也是 Enter，这时还不是「下一处」。
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    if (event.shiftKey) void previous();
    else void nextOrRun();
  });

  const scannedQueryMatches = (): boolean => query.value.trim().toLowerCase() === applied && applied !== '';

  async function nextOrRun(): Promise<void> {
    if (query.disabled || options.presenting()) return;
    if (!scannedQueryMatches()) {
      clearTimeout(debounce);
      await run();
      return;
    }
    stepOccurrence(1);
  }

  async function previous(): Promise<void> {
    if (query.disabled || options.presenting()) return;
    if (!scannedQueryMatches()) {
      clearTimeout(debounce);
      await run();
      return;
    }
    stepOccurrence(-1);
  }

  // 官方 Find again 不要求焦点还在查找框里。放映、空查询、别的输入都不接，避免把查找键绑进放映或扫不该扫的页。
  const findAgain = (delta: 1 | -1): boolean => {
    if (query.disabled || options.presenting() || !options.viewer()) return false;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement
      && active !== query
      && active.closest('input, textarea, select, [contenteditable]')
    ) return false;
    if (!query.value.trim()) return false;
    if (delta < 0) void previous();
    else void nextOrRun();
    return true;
  };

  return {
    reset() {
      generation += 1;
      clearTimeout(debounce);
      cache.clear();
      resetHits();
      resetViewerSearch(query, hitsLabel);
    },
    enable() {
      enableViewerSearch(query);
    },
    run,
    nextOrRun,
    previous,
    findAgain,
    syncHighlight: paintHighlight,
    focusIfAllowed() {
      if (query.disabled || options.presenting() || !options.viewer()) return false;
      query.focus();
      return true;
    },
  };
}
