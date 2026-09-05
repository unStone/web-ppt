export interface ChartCellRange {
  readonly sheet: string;
  readonly startColumn: number;
  readonly startRow: number;
  readonly endColumn: number;
  readonly endRow: number;
}

const MAX_COLUMN = 16_384;
const MAX_ROW = 1_048_576;

export function columnNumber(name: string): number {
  let value = 0;
  for (const char of name) value = value * 26 + char.charCodeAt(0) - 64;
  return value;
}

export function columnName(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > MAX_COLUMN) throw new Error('工作簿列号越界');
  let out = '';
  for (let current = value; current; current = Math.floor((current - 1) / 26)) {
    out = String.fromCharCode(65 + (current - 1) % 26) + out;
  }
  return out;
}

function sheetName(source: string): string | null {
  if (source.startsWith("'")) {
    if (!source.endsWith("'")) return null;
    return source.slice(1, -1).replace(/''/g, "'");
  }
  return /^[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_.\u0080-\uFFFF]*$/.test(source) ? source : null;
}

/** 只接受单工作表 A1 范围；外部引用、名称、3D 引用和并集一律拒绝。 */
export function parseChartFormula(formula: string | null): ChartCellRange | null {
  if (!formula || formula.length > 512 || formula.includes('[')) return null;
  const match = /^(('(?:[^']|'')+'|[^'!]+)!)\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/.exec(formula.trim());
  if (!match) return null;
  const sheet = sheetName(match[2]);
  const startColumn = columnNumber(match[3]);
  const startRow = Number(match[4]);
  const endColumn = columnNumber(match[5] ?? match[3]);
  const endRow = Number(match[6] ?? match[4]);
  if (!sheet || startColumn < 1 || endColumn > MAX_COLUMN || startColumn > endColumn
    || startRow < 1 || endRow > MAX_ROW || startRow > endRow) return null;
  return { sheet, startColumn, startRow, endColumn, endRow };
}

const quoteSheet = (name: string): string => /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name)
  ? name : `'${name.replace(/'/g, "''")}'`;

export function chartFormula(range: ChartCellRange): string {
  if (![range.startColumn, range.endColumn, range.startRow, range.endRow].every(Number.isInteger)
    || range.startColumn < 1 || range.endColumn > MAX_COLUMN || range.startColumn > range.endColumn
    || range.startRow < 1 || range.endRow > MAX_ROW || range.startRow > range.endRow) {
    throw new Error('工作簿范围越界');
  }
  const start = `$${columnName(range.startColumn)}$${range.startRow}`;
  const end = `$${columnName(range.endColumn)}$${range.endRow}`;
  return `${quoteSheet(range.sheet)}!${start}${start === end ? '' : `:${end}`}`;
}

export function resizedChartFormula(formula: string | null, count: number): string | null {
  const range = parseChartFormula(formula);
  if (!range || !Number.isInteger(count) || count < 1) return formula;
  if (range.startColumn === range.endColumn) return chartFormula({
    ...range, endRow: range.startRow + count - 1,
  });
  if (range.startRow === range.endRow) return chartFormula({
    ...range, endColumn: range.startColumn + count - 1,
  });
  return formula;
}
