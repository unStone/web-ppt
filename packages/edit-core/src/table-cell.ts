import { assertDataObject } from './data-validation';
import type { TableCellAddress, TableCellKey } from './types';

export function tableCellKey(cell: TableCellAddress): TableCellKey {
  return `${cell.r}:${cell.c}`;
}

export function parseTableCellKey(value: string): TableCellAddress | null {
  const match = /^(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(value);
  if (!match) return null;
  const cell = { r: Number(match[1]), c: Number(match[2]) };
  return Number.isSafeInteger(cell.r) && Number.isSafeInteger(cell.c) ? cell : null;
}

export function assertTableCellAddress(
  value: unknown,
  label: string,
): asserts value is TableCellAddress {
  assertDataObject(value, ['r', 'c'], label);
  const cell = value as TableCellAddress;
  if (!Number.isSafeInteger(cell.r) || cell.r < 0
    || !Number.isSafeInteger(cell.c) || cell.c < 0) {
    throw new Error(`${label} 必须使用非负安全整数行列坐标`);
  }
}
