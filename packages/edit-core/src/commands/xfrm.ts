import type { XfrmField } from './types';

export const XFRM_FIELDS: readonly XfrmField[] = ['x', 'y', 'w', 'h', 'rot'];
export const XFRM_FIELD_SET = new Set<XfrmField>(XFRM_FIELDS);

export function assertXfrmValue(field: XfrmField, value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} 必须是有限数值`);
  if ((field === 'w' || field === 'h') && value < 0) throw new Error(`${label} 不能为负数`);
}
