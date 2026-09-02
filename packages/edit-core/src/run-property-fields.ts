import { TEXT_RUN_DIRECT_BITS } from '@web-ppt/core';

/** 字符格式的唯一字段注册表；校验、投影、重基与保存均从这里派生。 */
export const STYLE_PROPERTY_FIELDS = [
  'font', 'size', 'color', 'b', 'i', 'underline', 'strikeType',
  'highlight', 'spacing', 'caps', 'baseline',
] as const;
export type StylePropertyField = typeof STYLE_PROPERTY_FIELDS[number];
export type DirectRunField = Exclude<StylePropertyField, 'font'> | 'u' | 'strike';

const STYLE_DIRECT_BITS = {
  size: TEXT_RUN_DIRECT_BITS.size,
  color: TEXT_RUN_DIRECT_BITS.color,
  b: TEXT_RUN_DIRECT_BITS.b,
  i: TEXT_RUN_DIRECT_BITS.i,
  underline: TEXT_RUN_DIRECT_BITS.u,
  strikeType: TEXT_RUN_DIRECT_BITS.strike,
  highlight: TEXT_RUN_DIRECT_BITS.highlight,
  spacing: TEXT_RUN_DIRECT_BITS.spacing,
  caps: TEXT_RUN_DIRECT_BITS.caps,
  baseline: TEXT_RUN_DIRECT_BITS.baseline,
} as const satisfies Record<Exclude<StylePropertyField, 'font'>, number>;

export const RUN_STYLE_DIRECT_FIELDS = Object.entries(STYLE_DIRECT_BITS) as readonly (
  readonly [Exclude<StylePropertyField, 'font'>, number]
)[];
export const RUN_DIRECT_FIELDS = [
  ...RUN_STYLE_DIRECT_FIELDS,
  ['u', TEXT_RUN_DIRECT_BITS.u],
  ['strike', TEXT_RUN_DIRECT_BITS.strike],
] as const satisfies readonly (readonly [DirectRunField, number])[];
export const RUN_REBASE_FIELDS = RUN_DIRECT_FIELDS.map(([field]) => field);
export const RUN_PROPERTY_FIELDS = [...STYLE_PROPERTY_FIELDS, 'u', 'strike', 'link'] as const;

export const FONT_DIRECT_BITS = TEXT_RUN_DIRECT_BITS.fonts | TEXT_RUN_DIRECT_BITS.fontLatin
  | TEXT_RUN_DIRECT_BITS.fontEastAsian | TEXT_RUN_DIRECT_BITS.fontComplexScript;
export const FONT_OVERRIDE_BIT = TEXT_RUN_DIRECT_BITS.fonts;

export function directRunBit(field: DirectRunField): number {
  return RUN_DIRECT_FIELDS.find(([candidate]) => candidate === field)?.[1] ?? 0;
}

export const LAYOUT_RUN_DIRECT_FIELDS = [
  ...RUN_DIRECT_FIELDS,
  ['outline', TEXT_RUN_DIRECT_BITS.outline],
  ['gradient', TEXT_RUN_DIRECT_BITS.gradient],
  ['underlineColor', TEXT_RUN_DIRECT_BITS.underlineColor],
] as const;
