import type {
  FindTextRequest, TextSearchMatch, TextSearchScope,
} from '@web-ppt/edit-core';

export type TextSearchMode = 'find' | 'replace';

export interface TextSearchOpenOptions {
  readonly mode?: TextSearchMode;
  readonly query?: string;
  readonly replacement?: string;
  readonly scope?: TextSearchScope;
  readonly matchCase?: boolean;
  readonly wholeWord?: boolean;
}

export type TextSearchOptions = Pick<FindTextRequest, 'scope' | 'matchCase' | 'wholeWord'>;

export interface TextSearchSnapshot {
  readonly open: boolean;
  readonly mode: TextSearchMode;
  readonly query: string;
  readonly replacement: string;
  readonly scope: TextSearchScope;
  readonly matchCase: boolean;
  readonly wholeWord: boolean;
  readonly matches: readonly TextSearchMatch[];
  readonly currentIndex: number;
  readonly current: TextSearchMatch | null;
  /** 外部事务让原精确范围消失；控制器已尽力重基到同一目标或相邻命中。 */
  readonly currentInvalidated: boolean;
}

export type TextSearchSubscriber = (snapshot: TextSearchSnapshot) => void;

export interface TextSearch {
  readonly snapshot: TextSearchSnapshot;
  readonly disposed: boolean;
  open(options?: TextSearchOpenOptions): void;
  close(): void;
  setQuery(query: string): void;
  setReplacement(replacement: string): void;
  setOptions(options: Partial<TextSearchOptions>): void;
  next(): TextSearchMatch | null;
  previous(): TextSearchMatch | null;
  replaceCurrent(): boolean;
  replaceAll(): number;
  subscribe(subscriber: TextSearchSubscriber): () => void;
  dispose(): void;
}
