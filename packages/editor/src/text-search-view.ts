import type { TextSearchMatch } from '@web-ppt/edit-core';
import type { EditorMode } from './slide-editor-types';
import { TextSearchHighlightProjection } from './text-search-highlight';
import type { TextSearch, TextSearchOpenOptions, TextSearchSnapshot } from './text-search-types';

function isTextInput(target: EventTarget | null): boolean {
  return target instanceof Element && (!!target.closest('[contenteditable="true"]')
    || target.matches('input,textarea,select'));
}

/** 每个视图只投影会话搜索状态；导航只让发起动作的视图跨页。 */
export class TextSearchViewBinding {
  readonly overlay: HTMLDivElement;
  private readonly unsubscribe: () => void;
  private readonly highlight: TextSearchHighlightProjection;
  private readonly originalAriaLabel: string | null;

  constructor(
    private readonly root: HTMLElement,
    staticLayer: HTMLElement,
    private readonly search: TextSearch,
    private readonly mode: () => EditorMode,
    private readonly readonlyDocument: () => boolean,
    private readonly slideId: () => string,
    private readonly reveal: (match: TextSearchMatch) => void,
    private readonly onError?: (error: unknown) => void,
  ) {
    this.originalAriaLabel = root.getAttribute('aria-label');
    this.overlay = root.ownerDocument.createElement('div');
    this.overlay.dataset.pptSearchOverlay = '';
    this.overlay.hidden = true;
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.style.position = 'absolute';
    this.overlay.style.inset = '0';
    this.overlay.style.zIndex = '20';
    this.overlay.style.pointerEvents = 'none';
    root.append(this.overlay);
    this.highlight = new TextSearchHighlightProjection(root, staticLayer, this.overlay);
    root.setAttribute('aria-keyshortcuts', 'Control+F Meta+F Control+H Meta+H');
    this.unsubscribe = search.subscribe(() => this.sync());
    this.sync();
  }

  open(options: TextSearchOpenOptions): void {
    this.search.open(options);
    this.revealCurrent();
  }
  close(): void { this.search.close(); }
  next(): TextSearchMatch | null { return this.navigate(1); }
  previous(): TextSearchMatch | null { return this.navigate(-1); }
  replaceCurrent(): boolean {
    if (this.mode() !== 'edit' || this.readonlyDocument()) return false;
    const changed = this.search.replaceCurrent();
    if (changed) this.revealCurrent();
    return changed;
  }
  replaceAll(): number {
    if (this.mode() !== 'edit' || this.readonlyDocument()) return 0;
    const count = this.search.replaceAll();
    this.revealCurrent();
    return count;
  }

  sync(): void {
    const snapshot = this.search.snapshot;
    if (!snapshot.open) {
      for (const key of [
        'textSearch', 'textSearchCount', 'textSearchIndex', 'textSearchReplaceDisabled',
        'textSearchInvalidated', 'textSearchAria',
      ]) delete this.root.dataset[key];
      this.highlight.clear();
      this.restoreAriaLabel();
      return;
    }
    this.root.dataset.textSearch = snapshot.mode;
    this.root.dataset.textSearchCount = String(snapshot.matches.length);
    this.root.dataset.textSearchIndex = String(snapshot.currentIndex);
    this.root.dataset.textSearchReplaceDisabled = String(
      this.mode() !== 'edit' || this.readonlyDocument(),
    );
    this.root.toggleAttribute('data-text-search-invalidated', snapshot.currentInvalidated);
    const label = this.ariaLabel(snapshot);
    this.root.dataset.textSearchAria = label;
    this.root.setAttribute('aria-label', label);
    this.highlight.sync(snapshot.matches, snapshot.current, this.slideId());
  }

  destroy(): void {
    this.unsubscribe();
    this.highlight.clear();
    this.overlay.remove();
    this.restoreAriaLabel();
  }

  readonly keydown = (event: KeyboardEvent): boolean => {
    const shortcut = (event.ctrlKey || event.metaKey) && !event.altKey;
    const key = event.key.toLowerCase();
    try {
      if (shortcut && (key === 'f' || key === 'h')) {
        this.open({ mode: key === 'h' ? 'replace' : 'find' });
        this.consume(event);
        return true;
      }
      if (!this.search.snapshot.open) return false;
      if (event.key === 'Escape') {
        this.close();
        this.consume(event);
        return true;
      } else if (event.key === 'Enter' && !event.isComposing && !isTextInput(event.target)) {
        if (event.shiftKey) this.previous();
        else this.next();
        this.consume(event);
        return true;
      }
      return false;
    } catch (error) {
      this.report(error);
      return true;
    }
  };

  private navigate(delta: 1 | -1): TextSearchMatch | null {
    const match = delta === 1 ? this.search.next() : this.search.previous();
    if (match) this.reveal(match);
    return match;
  }

  private revealCurrent(): void {
    const current = this.search.snapshot.current;
    if (current) this.reveal(current);
  }

  private ariaLabel(snapshot: TextSearchSnapshot): string {
    const current = snapshot.current;
    if (!current) return snapshot.query ? `未找到“${snapshot.query}”` : '查找文字';
    return `查找结果 ${snapshot.currentIndex + 1}/${snapshot.matches.length}：${current.before}${current.text}${current.after}`;
  }

  private consume(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  private report(error: unknown): void {
    const CustomEventCtor = this.root.ownerDocument.defaultView?.CustomEvent ?? CustomEvent;
    this.root.dispatchEvent(new CustomEventCtor('webpptsearcherror', { detail: error }));
    try { this.onError?.(error); } catch { /* 宿主错误观察者不能破坏搜索状态。 */ }
  }

  private restoreAriaLabel(): void {
    if (this.originalAriaLabel === null) this.root.removeAttribute('aria-label');
    else this.root.setAttribute('aria-label', this.originalAriaLabel);
  }
}
