import { columnName, parseChartFormula } from './formula';

const MAX_CELLS = 100_000;

export function addressParts(address: string): { column: number; row: number } {
  const match = /^([A-Z]{1,3})(\d+)$/.exec(address);
  if (!match) throw new Error(`单元格地址无效：${address}`);
  let column = 0;
  for (const char of match[1]) column = column * 26 + char.charCodeAt(0) - 64;
  const row = Number(match[2]);
  if (column < 1 || column > 16_384 || row < 1 || row > 1_048_576) {
    throw new Error(`单元格地址越界：${address}`);
  }
  return { column, row };
}

export function worksheetRangeBounds(reference: string): {
  readonly start: { column: number; row: number };
  readonly end: { column: number; row: number };
} {
  const ends = reference.toUpperCase().split(':');
  if (ends.length < 1 || ends.length > 2) throw new Error(`工作表范围无效：${reference}`);
  const start = addressParts(ends[0].replace(/\$/g, ''));
  const end = addressParts((ends[1] ?? ends[0]).replace(/\$/g, ''));
  if (start.column > end.column || start.row > end.row) throw new Error(`工作表范围无效：${reference}`);
  return { start, end };
}

export function worksheetRangeCells(reference: string): string[] {
  const { start, end } = worksheetRangeBounds(reference);
  if ((end.column - start.column + 1) * (end.row - start.row + 1) > MAX_CELLS) {
    throw new Error(`工作表范围过大：${reference}`);
  }
  const result: string[] = [];
  for (let row = start.row; row <= end.row; row++) {
    for (let column = start.column; column <= end.column; column++) {
      result.push(`${columnName(column)}${row}`);
    }
  }
  return result;
}

export function rangeCells(formula: string | null): string[] {
  const range = parseChartFormula(formula);
  if (!range) return [];
  return worksheetRangeCells(`${columnName(range.startColumn)}${range.startRow}`
    + `:${columnName(range.endColumn)}${range.endRow}`);
}
