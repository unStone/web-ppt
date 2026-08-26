import type { ElementId, SlideId, TableCellAddress } from './types';
import type { TextRange } from './commands/types';

export type TextSearchScope =
  | { readonly kind: 'document' }
  | { readonly kind: 'slide'; readonly slideId: SlideId }
  | { readonly kind: 'slides'; readonly slideIds: readonly SlideId[] };

export interface FindTextRequest {
  readonly query: string;
  readonly scope: TextSearchScope;
  readonly matchCase?: boolean;
  readonly wholeWord?: boolean;
}

export interface TextSearchMatch {
  /** 同一文档状态下可直接用作列表 key；模型变化后必须重新查询。 */
  readonly key: string;
  readonly slideId: SlideId;
  readonly id: ElementId;
  readonly cell?: TableCellAddress;
  readonly range: TextRange;
  readonly text: string;
  readonly before: string;
  readonly after: string;
}

export interface TextSearchTarget {
  readonly slideId: SlideId;
  readonly id: ElementId;
  readonly cell?: TableCellAddress;
  readonly range: TextRange;
}

export type ReplaceTextScope = TextSearchScope | {
  readonly kind: 'match';
  readonly match: TextSearchTarget;
};

export interface ReplaceTextCommand {
  readonly type: 'ReplaceText';
  readonly scope: ReplaceTextScope;
  readonly from: string;
  readonly to: string;
  readonly matchCase?: boolean;
  readonly wholeWord?: boolean;
}
