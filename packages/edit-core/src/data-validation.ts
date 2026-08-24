import type { TextPosition, TextRange } from './commands/types';

export const own = (object: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);

export function assertDataObject(
  value: unknown,
  fields: readonly string[],
  label: string,
): asserts value is object {
  if (!value || typeof value !== 'object'
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error(`${label} 必须是纯数据对象`);
  }
  const allowed = new Set(fields);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !allowed.has(key) || !descriptor?.enumerable || !('value' in descriptor)) {
      throw new Error(`${label} 包含未知或不可序列化字段：${String(key)}`);
    }
  }
}

export function assertTextPosition(value: unknown, label: string): asserts value is TextPosition {
  assertDataObject(value, ['p', 'r', 'off'], label);
  for (const field of ['p', 'r', 'off'] as const) {
    const fieldValue = (value as Record<string, unknown>)[field];
    if (!Number.isInteger(fieldValue) || Number(fieldValue) < 0) {
      throw new Error(`${label}.${field} 必须是非负整数`);
    }
  }
}

export function assertTextRange(value: unknown, label: string): asserts value is TextRange {
  assertDataObject(value, ['from', 'to'], label);
  assertTextPosition((value as TextRange).from, `${label}.from`);
  assertTextPosition((value as TextRange).to, `${label}.to`);
}
