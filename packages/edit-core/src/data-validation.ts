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

/** JSON 数组必须稠密且只能拥有索引与 length；否则序列化会吞掉空洞、访问器或附加状态。 */
export function assertDataArray(value: unknown, label: string): asserts value is readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new Error(`${label} 必须是纯数据数组`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys[keys.length - 1] !== 'length') {
    throw new Error(`${label} 必须是没有附加字段的稠密数组`);
  }
  for (let index = 0; index < value.length; index++) {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (keys[index] !== key || !descriptor?.enumerable || !('value' in descriptor)) {
      throw new Error(`${label}[${index}] 必须是可序列化的数据项`);
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
