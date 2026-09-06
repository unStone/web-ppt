import { attr } from '../xml';
export const CX = 'http://schemas.microsoft.com/office/drawing/2014/chartex';
export const LIMIT = 10000;
export type Value = string | number | null;
export const children = (node: Element | null, name: string, ns = CX): Element[] => Array.from(node?.children ?? []).filter((child) => child.localName === name && child.namespaceURI === ns);
export const child = (node: Element | null, name: string, ns = CX): Element | null => children(node, name, ns)[0] ?? null;
export function integer(raw: string | null, max = LIMIT): number {
  if (raw === null || !/^\d+$/.test(raw))
    throw new Error('无效 ChartEx 索引');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > max)
    throw new Error('ChartEx 索引超限');
  return value;
}
export function number(raw: string | null): number {
  if (raw === null || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.trim())) {
    throw new Error('无效 ChartEx 数值');
  }
  const value = Number(raw);
  if (!Number.isFinite(value))
    throw new Error('ChartEx 数值超限');
  return value;
}
export interface Dimension {
  type: string;
  numeric: boolean;
  source: 'cache' | 'literal' | 'workbook';
  /** 缓存按叶→根排列，工作表在读取边界反转，空槽始终保留。 */
  levels: Value[][];
  format: string | null;
}
export function readDimension(node: Element, resolve: (formula: Element) => Value[][]): Dimension {
  const numeric = node.localName === 'numDim';
  const formulas = children(node, 'f');
  if (formulas.length > 1)
    throw new Error('ChartEx 公式不唯一');
  const levels = children(node, 'lvl');
  let total = 0;
  const read = (level: Element): Value[] => {
    const count = integer(attr(level, 'ptCount'));
    if ((total += count) > LIMIT)
      throw new Error('ChartEx 数据超限');
    const values: Value[] = Array.from({ length: count }, () => null);
    const seen = new Set<number>();
    for (const point of children(level, 'pt')) {
      const index = integer(attr(point, 'idx'));
      if (index >= count || seen.has(index) || point.children.length)
        throw new Error('ChartEx 数据点冲突');
      seen.add(index);
      values[index] = numeric ? number(point.textContent) : point.textContent ?? '';
    }
    return values;
  };
  const values = levels.length ? levels.map(read) : formulas.length ? resolve(formulas[0]) : [];
  if (levels.length && formulas.length) {
    const workbook = resolve(formulas[0]);
    if (JSON.stringify(values) !== JSON.stringify(workbook))
      throw new Error('ChartEx 缓存与工作簿不一致');
  }
  if (!values.length || values.some((level) => level.some((v) => v !== null && typeof v !== (numeric ? 'number' : 'string')))) {
    throw new Error('ChartEx 维度缺失或类型不匹配');
  }
  return { type: attr(node, 'type') ?? '', numeric,
    source: levels.length ? formulas.length ? 'cache' : 'literal' : 'workbook',
    levels: values, format: attr(levels[0] ?? null, 'formatCode') };
}
