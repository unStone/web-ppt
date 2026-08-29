export interface TextFontSlots {
  readonly latin: string | null;
  readonly eastAsian: string | null;
  readonly complexScript: string | null;
}

export interface TextRunEditInfo {
  readonly inheritedRunProps: {
    readonly b: boolean;
    readonly i: boolean;
    readonly u: boolean;
    readonly strike: boolean;
    readonly size: number;
    readonly color: string;
    readonly fonts: string[];
    readonly baseline?: number;
    readonly spacing?: number;
    readonly caps?: 'none' | 'all' | 'small';
    readonly outline?: { color: string; width: number } | null;
    readonly gradient?: string | null;
    readonly highlight?: string | null;
    readonly underlineColor?: string | null;
  };
  /** 继承链按脚本求值后的槽位；清除单字体直设时不能从去重后的 CSS 字体栈反推。 */
  readonly inheritedFontSlots?: TextFontSlots;
  /** rPr 自己声明的字符字段位；段落 defRPr 的直设位另存于 Paragraph.editInfo。 */
  readonly direct: TextRunDirectFlags;
  /** 有效字体按脚本保留；换版式时只重基未直设的脚本槽。 */
  readonly fontSlots: TextFontSlots;
  /** 来源 hlinkClick 无法安全解析；编辑层只展示只读占位，不暴露原始 action/URL。 */
  readonlyLink?: true;
}

export const PLACEHOLDER_DIRECT_BITS = {
  transform: 1 << 0,
  geometry: 1 << 1,
  fill: 1 << 2,
  stroke: 1 << 3,
  effects: 1 << 4,
  style: 1 << 5,
} as const;

export const TEXT_RUN_DIRECT_BITS = {
  b: 1 << 0,
  i: 1 << 1,
  u: 1 << 2,
  strike: 1 << 3,
  size: 1 << 4,
  fonts: 1 << 5,
  color: 1 << 6,
  baseline: 1 << 7,
  spacing: 1 << 8,
  caps: 1 << 9,
  outline: 1 << 10,
  gradient: 1 << 11,
  highlight: 1 << 12,
  underlineColor: 1 << 13,
  fontLatin: 1 << 14,
  fontEastAsian: 1 << 15,
  fontComplexScript: 1 << 16,
} as const;

export const PARAGRAPH_LAYOUT_DIRECT_BITS = {
  bullet: 1 << 0,
  bulletColor: 1 << 1,
  bulletFont: 1 << 2,
  bulletSize: 1 << 3,
  rtl: 1 << 4,
} as const;

declare const DIRECT_FLAGS_BRAND: unique symbol;

/** 三类位集不能互换；运行时仍是紧凑 number，不增加投影热路径成本。 */
export type PlaceholderDirectFlags = number & { readonly [DIRECT_FLAGS_BRAND]: 'placeholder' };
export type TextRunDirectFlags = number & { readonly [DIRECT_FLAGS_BRAND]: 'text-run' };
export type ParagraphLayoutDirectFlags = number & { readonly [DIRECT_FLAGS_BRAND]: 'paragraph-layout' };

export function placeholderDirectFlags(value: number): PlaceholderDirectFlags {
  return value as PlaceholderDirectFlags;
}

export function textRunDirectFlags(value: number): TextRunDirectFlags {
  return value as TextRunDirectFlags;
}

export function paragraphLayoutDirectFlags(value: number): ParagraphLayoutDirectFlags {
  return value as ParagraphLayoutDirectFlags;
}
