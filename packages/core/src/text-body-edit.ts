import type { TextBodyLayoutProperties } from './types';

export type TextBodyEditableProperty =
  | 'anchor' | 'insets' | 'wrap' | 'vert' | 'anchorCtr' | 'columns' | 'columnGap' | 'autoFit';

export const TEXT_BODY_PROPERTY_BITS: Readonly<Record<TextBodyEditableProperty, number>> = {
  anchor: 1 << 0,
  insets: 1 << 1,
  wrap: 1 << 2,
  vert: 1 << 3,
  anchorCtr: 1 << 4,
  columns: 1 << 5,
  columnGap: 1 << 6,
  autoFit: 1 << 7,
};

export interface TextBodyEditInfo {
  /** 去掉当前形状 bodyPr 后，由版式、母版和 OOXML 默认值求出的结果。 */
  inherited?: TextBodyLayoutProperties;
  /** 当前形状 bodyPr 真正直设的字段位；紧凑表示避免空文字框批量历史膨胀。 */
  direct: number;
}
