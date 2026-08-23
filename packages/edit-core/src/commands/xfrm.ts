import type { FlipField, NumericXfrmField, XfrmField, XfrmValueByField } from './types';

export const NUMERIC_XFRM_FIELDS: readonly NumericXfrmField[] = ['x', 'y', 'w', 'h', 'rot'];
export const FLIP_FIELDS: readonly FlipField[] = ['flipH', 'flipV'];
export const XFRM_FIELDS: readonly XfrmField[] = [...NUMERIC_XFRM_FIELDS, ...FLIP_FIELDS];
export const XFRM_FIELD_SET = new Set<XfrmField>(XFRM_FIELDS);
const FRAME_XFRM_FIELD_SET = new Set<XfrmField>(['x', 'y', 'w', 'h']);

export const isFrameXfrmField = (field: XfrmField): boolean => FRAME_XFRM_FIELD_SET.has(field);

export function assertXfrmValue<F extends XfrmField>(
  field: F,
  value: unknown,
  label: string,
): asserts value is XfrmValueByField[F] {
  if (field === 'flipH' || field === 'flipV') {
    if (typeof value !== 'boolean') throw new Error(`${label} 必须是布尔值`);
    return;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} 必须是有限数值`);
  if ((field === 'w' || field === 'h') && value < 0) throw new Error(`${label} 不能为负数`);
}
