import type { ElementRecord } from './types';

export const MAX_ELEMENT_NAME_LENGTH = 255;

export function assertElementName(value: unknown, label = '元素名称'): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`);
  if (value.length > MAX_ELEMENT_NAME_LENGTH) {
    throw new Error(`${label}不能超过 ${MAX_ELEMENT_NAME_LENGTH} 个 UTF-16 单元`);
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label}不能包含控制字符`);
}

export function elementName(record: ElementRecord): string {
  return Object.prototype.hasOwnProperty.call(record.ovr, 'name')
    ? record.ovr.name as string
    : record.src.name?.trim() || `${record.src.kind} ${record.meta.origin?.spid ?? record.id}`;
}
