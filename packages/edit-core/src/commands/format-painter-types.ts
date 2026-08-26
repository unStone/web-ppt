import type { ElementId, TableCellAddress } from '../types';
import type { TextRange } from './types';
import { assertDataArray } from '../data-validation';

export const FORMAT_MASK_FIELDS = Object.freeze([
  'fill', 'stroke', 'effects', 'run', 'paragraph', 'body',
] as const);
export type FormatMaskField = typeof FORMAT_MASK_FIELDS[number];
const formatMaskFields = new Set<string>(FORMAT_MASK_FIELDS);

export function assertFormatMask(
  value: unknown,
  label = '格式刷 mask',
): asserts value is readonly FormatMaskField[] {
  assertDataArray(value, label);
  if (!value.length || value.some((field) => typeof field !== 'string'
    || !formatMaskFields.has(field)) || new Set(value).size !== value.length) {
    throw new Error(`${label} 必须是非空、无重复的已知格式掩码`);
  }
}

export interface ApplyFormatCommand {
  readonly type: 'ApplyFormat';
  readonly from: ElementId;
  readonly to: ElementId;
  readonly mask: readonly FormatMaskField[];
  readonly fromCell?: TableCellAddress;
  readonly toCell?: TableCellAddress;
  /** 省略表示整个来源文本体；只对 run/paragraph 生效。 */
  readonly fromRange?: TextRange;
  /** 省略表示整个目标文本体；只对 run/paragraph 生效。 */
  readonly toRange?: TextRange;
}
