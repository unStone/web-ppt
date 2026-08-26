import type {
  ElementId, FormatMaskField, TableCellAddress, TextRange,
} from '@web-ppt/edit-core';

export interface FormatPainterStartOptions {
  /** false/undefined 表示成功一次后自动退出。 */
  readonly continuous?: boolean;
  /** 省略时根据当前元素或文字选区选择安全默认值。 */
  readonly mask?: readonly FormatMaskField[];
}

export interface FormatPainterSource {
  readonly id: ElementId;
  readonly cell?: TableCellAddress;
  readonly range?: TextRange;
  readonly mask: readonly FormatMaskField[];
}

export interface FormatPainterTarget {
  readonly id: ElementId;
  readonly cell?: TableCellAddress;
  readonly range?: TextRange;
}

export interface FormatPainterSnapshot {
  readonly active: boolean;
  readonly mode: 'inactive' | 'single' | 'continuous';
  readonly source: FormatPainterSource | null;
}

export type FormatPainterSubscriber = (snapshot: FormatPainterSnapshot) => void;

export interface FormatPainter {
  readonly snapshot: FormatPainterSnapshot;
  readonly disposed: boolean;
  start(options?: FormatPainterStartOptions): boolean;
  apply(target: FormatPainterTarget): boolean;
  cancel(): void;
  subscribe(subscriber: FormatPainterSubscriber): () => void;
}
