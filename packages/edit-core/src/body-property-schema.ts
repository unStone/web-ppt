import { assertDataObject } from './data-validation';
import type { TextBodyPropertyOverrides } from './types';

export const BODY_PROPERTY_FIELDS = [
  'anchor', 'insets', 'wrap', 'vert', 'anchorCtr', 'columns', 'columnGap', 'autoFit',
] as const;

export function assertTextBodyPropertyOverrides(
  value: TextBodyPropertyOverrides,
  label: string,
): void {
  assertDataObject(value, BODY_PROPERTY_FIELDS, label);
  if (!Reflect.ownKeys(value).length) throw new Error(`${label} 不能为空`);
  for (const field of BODY_PROPERTY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, field) && value[field] === undefined) {
      throw new Error(`${label}.${field} 不能是 undefined`);
    }
  }
  if (value.anchor !== undefined && value.anchor !== null
    && !['top', 'middle', 'bottom'].includes(value.anchor)) {
    throw new Error(`${label}.anchor 无效`);
  }
  if (value.insets !== undefined && value.insets !== null) {
    if (!Array.isArray(value.insets) || value.insets.length !== 4
      || value.insets.some((part) => typeof part !== 'number' || !Number.isFinite(part) || part < 0)) {
      throw new Error(`${label}.insets 必须是四个有限非负数`);
    }
  }
  if (value.wrap !== undefined && value.wrap !== null && typeof value.wrap !== 'boolean') {
    throw new Error(`${label}.wrap 无效`);
  }
  if (value.vert !== undefined && value.vert !== null
    && !['horz', 'vert', 'vert270', 'wordArtVert'].includes(value.vert)) {
    throw new Error(`${label}.vert 无效`);
  }
  if (value.anchorCtr !== undefined && value.anchorCtr !== null
    && typeof value.anchorCtr !== 'boolean') {
    throw new Error(`${label}.anchorCtr 无效`);
  }
  if (value.columns !== undefined && value.columns !== null
    && (!Number.isInteger(value.columns) || value.columns < 1 || value.columns > 16)) {
    throw new Error(`${label}.columns 必须是 1 到 16 的整数`);
  }
  if (value.columnGap !== undefined && value.columnGap !== null
    && (typeof value.columnGap !== 'number' || !Number.isFinite(value.columnGap) || value.columnGap < 0)) {
    throw new Error(`${label}.columnGap 必须是有限非负数`);
  }
  if (value.autoFit !== undefined && value.autoFit !== null
    && !['none', 'normal', 'shape'].includes(value.autoFit)) {
    throw new Error(`${label}.autoFit 无效`);
  }
}
