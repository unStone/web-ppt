import { assertFindTextRequest, TEXT_ATOM } from '@web-ppt/edit-core';
import type {
  Editor, FindTextRequest, TextPosition, TextSearchMatch, TextSearchScope,
} from '@web-ppt/edit-core';
import { SessionTextSearchIndex } from './text-search-index';
import type {
  TextSearch, TextSearchOpenOptions, TextSearchOptions, TextSearchSnapshot,
  TextSearchSubscriber,
} from './text-search-types';

const own = (value: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(value, key);
const DOCUMENT_SCOPE: TextSearchScope = Object.freeze({ kind: 'document' });

function assertDataObject(value: unknown, fields: readonly string[], label: string): asserts value is object {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} 必须是纯数据对象`);
  }
  const allowed = new Set(fields);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !allowed.has(key) || !descriptor?.enumerable || !('value' in descriptor)) {
      throw new Error(`${label} 包含未知或不可序列化字段：${String(key)}`);
    }
  }
}

function cloneScope(scope: TextSearchScope): TextSearchScope {
  if (scope.kind === 'document') return DOCUMENT_SCOPE;
  if (scope.kind === 'slide') return Object.freeze({ kind: 'slide', slideId: scope.slideId });
  return Object.freeze({ kind: 'slides', slideIds: Object.freeze([...scope.slideIds]) });
}

function cloneMatch(match: TextSearchMatch): TextSearchMatch {
  const from = Object.freeze({ ...match.range.from });
  const to = Object.freeze({ ...match.range.to });
  return Object.freeze({
    ...match,
    ...(match.cell ? { cell: Object.freeze({ ...match.cell }) } : {}),
    range: Object.freeze({ from, to }),
  });
}

function positionWeight(position: TextPosition): number {
  return position.p * 1_000_000_000 + position.r * 1_000_000 + position.off;
}

function sameTarget(left: TextSearchMatch, right: TextSearchMatch): boolean {
  return left.id === right.id && (left.cell === undefined ? right.cell === undefined
    : right.cell !== undefined && left.cell.r === right.cell.r && left.cell.c === right.cell.c);
}

function report(error: unknown): void {
  try { globalThis.reportError?.(error); } catch { /* 搜索订阅者不能破坏模型事务。 */ }
}

/** 会话只保留模型身份与纯数据状态；DOM 视图和框架包都是薄消费者。 */
export class SessionTextSearch implements TextSearch {
  private readonly index: SessionTextSearchIndex;
  private readonly unsubscribeEditor: () => void;
  private readonly subscribers = new Set<TextSearchSubscriber>();
  private currentMatches: readonly TextSearchMatch[] = [];
  private currentIndex = -1;
  private isOpen = false;
  private mode: TextSearchSnapshot['mode'] = 'find';
  private query = '';
  private replacement = '';
  private scope: TextSearchScope = DOCUMENT_SCOPE;
  private matchCase = false;
  private wholeWord = false;
  private invalidated = false;
  private currentSnapshot: TextSearchSnapshot;
  private mutating = false;
  private isDisposed = false;

  constructor(private readonly editor: Editor) {
    this.index = new SessionTextSearchIndex(editor);
    this.currentSnapshot = this.snapshotOf();
    this.unsubscribeEditor = editor.subscribe((change) => {
      if (this.mutating || !this.isOpen || !this.query || change.source === 'selection') return;
      this.refresh(true);
    });
  }

  get snapshot(): TextSearchSnapshot { return this.currentSnapshot; }
  get disposed(): boolean { return this.isDisposed; }

  open(options: TextSearchOpenOptions = {}): void {
    this.assertActive();
    assertDataObject(options, ['mode', 'query', 'replacement', 'scope', 'matchCase', 'wholeWord'], '文字搜索选项');
    let nextMode = this.mode;
    if (own(options, 'mode')) {
      if (options.mode !== 'find' && options.mode !== 'replace') throw new Error('文字搜索 mode 无效');
      nextMode = options.mode;
    }
    let nextQuery = this.query;
    if (own(options, 'query')) { this.assertQuery(options.query); nextQuery = options.query; }
    let nextReplacement = this.replacement;
    if (own(options, 'replacement')) {
      this.assertReplacement(options.replacement);
      nextReplacement = options.replacement;
    }
    const nextScope = own(options, 'scope') ? this.assertScope(options.scope) : this.scope;
    const nextMatchCase = own(options, 'matchCase')
      ? this.assertBoolean(options.matchCase, 'matchCase') : this.matchCase;
    const nextWholeWord = own(options, 'wholeWord')
      ? this.assertBoolean(options.wholeWord, 'wholeWord') : this.wholeWord;
    this.mode = nextMode;
    this.query = nextQuery;
    this.replacement = nextReplacement;
    this.scope = nextScope;
    this.matchCase = nextMatchCase;
    this.wholeWord = nextWholeWord;
    this.isOpen = true;
    this.refresh(false, 0);
  }

  close(): void {
    this.assertActive();
    if (!this.isOpen && !this.currentMatches.length) return;
    this.isOpen = false;
    this.currentMatches = [];
    this.currentIndex = -1;
    this.invalidated = false;
    this.publish();
  }

  setQuery(query: string): void {
    this.assertActive();
    this.assertQuery(query);
    if (query === this.query) return;
    this.query = query;
    this.refresh(false, 0);
  }

  setReplacement(replacement: string): void {
    this.assertActive();
    this.assertReplacement(replacement);
    if (replacement === this.replacement) return;
    this.replacement = replacement;
    this.publish();
  }

  setOptions(options: Partial<TextSearchOptions>): void {
    this.assertActive();
    assertDataObject(options, ['scope', 'matchCase', 'wholeWord'], '文字搜索匹配选项');
    const nextScope = own(options, 'scope') ? this.assertScope(options.scope) : this.scope;
    const nextMatchCase = own(options, 'matchCase')
      ? this.assertBoolean(options.matchCase, 'matchCase') : this.matchCase;
    const nextWholeWord = own(options, 'wholeWord')
      ? this.assertBoolean(options.wholeWord, 'wholeWord') : this.wholeWord;
    this.scope = nextScope;
    this.matchCase = nextMatchCase;
    this.wholeWord = nextWholeWord;
    this.refresh(false, 0);
  }

  next(): TextSearchMatch | null { return this.step(1); }
  previous(): TextSearchMatch | null { return this.step(-1); }

  replaceCurrent(): boolean {
    this.assertActive();
    if (this.editor.doc.meta.readonly) throw new Error('只读文档不能替换文字');
    const current = this.currentMatches[this.currentIndex];
    if (!this.isOpen || !current || !this.query) return false;
    const preferred = this.currentIndex;
    this.mutating = true;
    try {
      this.editor.exec({
        type: 'ReplaceText', from: this.query, to: this.replacement,
        matchCase: this.matchCase, wholeWord: this.wholeWord,
        scope: { kind: 'match', match: {
          slideId: current.slideId, id: current.id,
          ...(current.cell ? { cell: { ...current.cell } } : {}),
          range: { from: { ...current.range.from }, to: { ...current.range.to } },
        } },
      });
    } finally {
      this.mutating = false;
    }
    this.refresh(false, preferred);
    return true;
  }

  replaceAll(): number {
    this.assertActive();
    if (this.editor.doc.meta.readonly) throw new Error('只读文档不能替换文字');
    if (!this.isOpen || !this.query || !this.currentMatches.length) return 0;
    const count = this.currentMatches.length;
    this.mutating = true;
    try {
      this.editor.exec({
        type: 'ReplaceText', from: this.query, to: this.replacement,
        matchCase: this.matchCase, wholeWord: this.wholeWord, scope: cloneScope(this.scope),
      });
    } finally {
      this.mutating = false;
    }
    this.refresh(false, 0);
    return count;
  }

  subscribe(subscriber: TextSearchSubscriber): () => void {
    this.assertActive();
    if (typeof subscriber !== 'function') throw new Error('文字搜索订阅者必须是函数');
    this.subscribers.add(subscriber);
    return () => { this.subscribers.delete(subscriber); };
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.unsubscribeEditor();
    this.index.dispose();
    this.isOpen = false;
    this.currentMatches = [];
    this.currentIndex = -1;
    this.invalidated = false;
    this.publish();
    this.subscribers.clear();
  }

  private refresh(preserve: boolean, preferredIndex?: number): void {
    const previous = preserve ? this.currentMatches[this.currentIndex] : null;
    this.currentMatches = this.isOpen && this.query ? this.index.find(this.request()) : [];
    this.invalidated = false;
    if (!this.currentMatches.length) this.currentIndex = -1;
    else if (previous) {
      const exact = this.currentMatches.findIndex((match) => match.key === previous.key);
      if (exact >= 0) this.currentIndex = exact;
      else {
        this.invalidated = true;
        const candidates = this.currentMatches.map((match, index) => ({ match, index }))
          .filter(({ match }) => sameTarget(match, previous))
          .sort((left, right) => Math.abs(positionWeight(left.match.range.from) - positionWeight(previous.range.from))
            - Math.abs(positionWeight(right.match.range.from) - positionWeight(previous.range.from)));
        this.currentIndex = candidates[0]?.index ?? Math.min(this.currentIndex, this.currentMatches.length - 1);
      }
    } else this.currentIndex = Math.min(Math.max(preferredIndex ?? 0, 0), this.currentMatches.length - 1);
    this.publish();
  }

  private step(delta: 1 | -1): TextSearchMatch | null {
    this.assertActive();
    if (!this.isOpen || !this.currentMatches.length) return null;
    this.currentIndex = (this.currentIndex + delta + this.currentMatches.length) % this.currentMatches.length;
    this.invalidated = false;
    this.publish();
    return this.currentSnapshot.current;
  }

  private request(): FindTextRequest {
    return {
      query: this.query, scope: cloneScope(this.scope),
      matchCase: this.matchCase, wholeWord: this.wholeWord,
    };
  }

  private snapshotOf(): TextSearchSnapshot {
    const matches = Object.freeze(this.currentMatches.map(cloneMatch));
    return Object.freeze({
      open: this.isOpen, mode: this.mode, query: this.query, replacement: this.replacement,
      scope: cloneScope(this.scope), matchCase: this.matchCase, wholeWord: this.wholeWord,
      matches, currentIndex: this.currentIndex,
      current: this.currentIndex >= 0 ? matches[this.currentIndex] : null,
      currentInvalidated: this.invalidated,
    });
  }

  private publish(): void {
    this.currentSnapshot = this.snapshotOf();
    for (const subscriber of [...this.subscribers]) {
      try { subscriber(this.currentSnapshot); } catch (error) { report(error); }
    }
  }

  private assertQuery(value: unknown): asserts value is string {
    if (typeof value !== 'string' || value.includes('\r') || value.includes('\n') || value.includes(TEXT_ATOM)) {
      throw new Error('文字搜索 query 必须是不含换行与公式占位符的字符串');
    }
  }

  private assertReplacement(value: unknown): asserts value is string {
    if (typeof value !== 'string' || value.includes('\r') || value.includes('\n') || value.includes(TEXT_ATOM)) {
      throw new Error('文字搜索 replacement 必须是不含换行与公式占位符的字符串');
    }
  }

  private assertScope(value: unknown): TextSearchScope {
    // scope 校验不能顺带建立搜索缓存，否则打开搜索框会浪费一次全页扫描。
    assertFindTextRequest(this.editor.doc, {
      query: this.query || '\u0001', scope: value as TextSearchScope,
    });
    return cloneScope(value as TextSearchScope);
  }

  private assertBoolean(value: unknown, name: string): boolean {
    if (typeof value !== 'boolean') throw new Error(`文字搜索 ${name} 必须是布尔值`);
    return value;
  }

  private assertActive(): void {
    if (this.isDisposed) throw new Error('文字搜索控制器已经释放');
  }
}
