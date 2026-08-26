import type { TextSearchMatch } from '@web-ppt/edit-core';
import type { EditorSession } from './session';
import type { EditorMode } from './slide-editor-types';
import type {
  TextSearchOpenOptions, TextSearchOptions, TextSearchSnapshot,
} from './text-search-types';
import type { WebPptTextSearchState } from './framework-adapter-types';

const IDLE: WebPptTextSearchState = Object.freeze({
  open: false,
  mode: 'find',
  query: '',
  replacement: '',
  scope: Object.freeze({ kind: 'document' }),
  matchCase: false,
  wholeWord: false,
  matches: Object.freeze([]),
  currentIndex: -1,
  current: null,
  currentInvalidated: false,
  canReplace: false,
});

/** adapter 仅转发会话搜索；React/Vue/Svelte 不应各自维护第二份状态机。 */
export class AdapterTextSearchBinding {
  private session: EditorSession | null = null;
  private unsubscribe: (() => void) | null = null;
  private source: TextSearchSnapshot | null = null;
  private previous: WebPptTextSearchState = IDLE;

  constructor(private readonly reveal: (match: TextSearchMatch) => void) {}

  bind(session: EditorSession, changed: () => void): void {
    this.release();
    this.session = session;
    this.unsubscribe = session.textSearch.subscribe(changed);
  }

  release(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.session = null;
    this.source = null;
    this.previous = IDLE;
  }

  open(options: TextSearchOpenOptions): void {
    this.session?.textSearch.open(options);
    this.revealCurrent();
  }
  close(): void { this.session?.textSearch.close(); }
  setQuery(query: string): void {
    this.session?.textSearch.setQuery(query);
    this.revealCurrent();
  }
  setReplacement(replacement: string): void { this.session?.textSearch.setReplacement(replacement); }
  setOptions(options: Partial<TextSearchOptions>): void {
    this.session?.textSearch.setOptions(options);
    this.revealCurrent();
  }
  next(): TextSearchMatch | null { return this.navigate(() => this.session?.textSearch.next() ?? null); }
  previousMatch(): TextSearchMatch | null {
    return this.navigate(() => this.session?.textSearch.previous() ?? null);
  }
  replaceCurrent(): boolean {
    const changed = this.session?.textSearch.replaceCurrent() ?? false;
    if (changed) this.revealCurrent();
    return changed;
  }
  replaceAll(): number {
    const count = this.session?.textSearch.replaceAll() ?? 0;
    if (count) this.revealCurrent();
    return count;
  }

  state(ready: boolean, mode: EditorMode): WebPptTextSearchState {
    const source = this.session?.textSearch.snapshot ?? IDLE;
    const canReplace = !!ready && !!this.session && !this.session.editor.doc.meta.readonly && mode === 'edit';
    if (this.source === source && this.previous.canReplace === canReplace) return this.previous;
    this.source = source;
    this.previous = { ...source, canReplace };
    return this.previous;
  }

  private navigate(action: () => TextSearchMatch | null): TextSearchMatch | null {
    const match = action();
    if (match) this.reveal(match);
    return match;
  }

  private revealCurrent(): void {
    const current = this.session?.textSearch.snapshot.current;
    if (current) this.reveal(current);
  }
}
