import { assertDataObject, own } from './data-validation';
import type { RunPropertyOverrides } from './types';

export const RUN_PROPERTY_FIELDS = ['font', 'size', 'b', 'i', 'u', 'strike'] as const;

export function assertRunPropertyOverrides(
  value: unknown,
  label: string,
  allowEmpty = false,
): asserts value is RunPropertyOverrides {
  assertDataObject(value, RUN_PROPERTY_FIELDS, label);
  if (!allowEmpty && !RUN_PROPERTY_FIELDS.some((field) => own(value, field))) {
    throw new Error(`${label} 不能为空`);
  }
  const props = value as RunPropertyOverrides;
  if (own(props, 'font') && props.font !== null
    && (typeof props.font !== 'string' || !props.font.trim() || props.font !== props.font.trim()
      || /[\u0000-\u001f]/.test(props.font))) {
    throw new Error(`${label}.font 必须是非空字体名或 null`);
  }
  if (own(props, 'size') && props.size !== null
    && (typeof props.size !== 'number' || !Number.isFinite(props.size) || props.size <= 0)) {
    throw new Error(`${label}.size 必须是有限正数或 null`);
  }
  for (const field of ['b', 'i', 'u', 'strike'] as const) {
    if (own(props, field) && props[field] !== null && typeof props[field] !== 'boolean') {
      throw new Error(`${label}.${field} 必须是布尔值或 null`);
    }
  }
}
