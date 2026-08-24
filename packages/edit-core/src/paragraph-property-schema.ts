import { assertDataObject, own } from './data-validation';
import type { ParagraphPropertyOverrides } from './types';

export const PARAGRAPH_PROPERTY_FIELDS = [
  'align', 'lineHeight', 'spaceBefore', 'spaceAfter', 'marginLeft', 'indent',
] as const;
export const PARAGRAPH_ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const;

export function assertParagraphPropertyOverrides(
  value: ParagraphPropertyOverrides,
  label: string,
): void {
  assertDataObject(value, PARAGRAPH_PROPERTY_FIELDS, label);
  if (!PARAGRAPH_PROPERTY_FIELDS.some((field) => own(value, field))) {
    throw new Error(`${label} 不能为空`);
  }
  if (own(value, 'align') && value.align !== null
    && !PARAGRAPH_ALIGNMENTS.includes(value.align as typeof PARAGRAPH_ALIGNMENTS[number])) {
    throw new Error(`${label}.align 无效`);
  }
  for (const field of PARAGRAPH_PROPERTY_FIELDS.slice(1)) {
    const fieldValue = value[field];
    if (!own(value, field) || fieldValue === null) continue;
    if (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue)) {
      throw new Error(`${label}.${field} 必须是有限数或 null`);
    }
    if (field === 'lineHeight' && fieldValue < 0.5) throw new Error(`${label}.lineHeight 不能小于 0.5`);
    if (field !== 'indent' && fieldValue < 0) throw new Error(`${label}.${field} 不能为负数`);
  }
}
