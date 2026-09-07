import { parseXmlTree } from '@web-ppt/edit-core/xml';
import type { XmlElement } from '@web-ppt/edit-core/xml';
import type { ChartDatasetState, ChartFormulaBinding } from './types';
import type { WorkbookMap } from './workbook';
import { columnName, parseChartFormula } from './formula';
import { resolvedCategoryLevels } from './category-levels';
import { orderedChartRecords } from './ordering';
import { worksheetXml, xmlAttribute as attr, xmlContent as text } from './xml-data';

const { child, children } = worksheetXml;
export type CategoryWorkbookCell = { readonly kind: 'string' | 'number'; readonly value: string | number | null };
type Values = Pick<ChartDatasetState, 'categories' | 'series'>;
const categoryBinding = (state: Values) => orderedChartRecords(Object.values(state.series))
  .find(series => series.bindings.categories?.hierarchy)?.bindings.categories;

function sheetCells(parts: Readonly<Record<string, Uint8Array>>, map: WorkbookMap, sheet: string): Map<string, XmlElement> {
  const root = parseXmlTree(parts[map.sheets.get(sheet)!]).root, cells = new Map<string, XmlElement>();
  for (const row of children(child(root, 'sheetData'), 'row')) {
    for (const cell of children(row, 'c')) cells.set(attr(cell, 'r')!, cell);
  }
  return cells;
}

function address(binding: ChartFormulaBinding, point: number, level: number): string {
  const range = parseChartFormula(binding.formula)!;
  return binding.hierarchy!.orientation === 'rows'
    ? `${columnName(range.startColumn + level)}${range.startRow + point}`
    : `${columnName(range.startColumn + point)}${range.startRow + level}`;
}

export function categoryWorkbookWrites(
  source: Values, planned: Values, parts: Readonly<Record<string, Uint8Array>>, map: WorkbookMap,
): { sheet: string; cells: Map<string, CategoryWorkbookCell> } | undefined {
  if (!Object.values(planned.series).some(series => !series.removed && series.bindings.categories?.hierarchy)) return;
  const binding = categoryBinding(planned), original = categoryBinding(source);
  if (!binding?.hierarchy || !original) return;
  const range = parseChartFormula(binding.formula)!;
  const cells = sheetCells(parts, map, range.sheet);
  // 墓碑留在来源序列中，因此删除前后的行号不能直接作为单元格身份。
  const origins = new Map(orderedChartRecords(Object.values(source.categories)).map((category, index) => [category.id, index]));
  const categories = orderedChartRecords(Object.values(planned.categories).filter(category => !category.removed));
  const resolved = resolvedCategoryLevels(categories, binding.hierarchy.levels);
  const writes = new Map<string, CategoryWorkbookCell>();
  categories.forEach((category, point) => {
    for (let level = 0; level < binding.hierarchy!.levels; level++) {
      const cell = cells.get(address(original, origins.get(category.id)!, level));
      const raw = category.levels?.[level] ?? null;
      const populated = !!(cell && (child(cell, 'v') || child(cell, 'is')));
      const value = raw ?? (populated ? resolved[point][level] : null);
      const numeric = cell && !['s', 'inlineStr'].includes(attr(cell, 't') ?? '')
        && value !== null && Number.isFinite(Number(value)) && String(Number(value)) === value;
      writes.set(address(binding, point, level), { kind: numeric ? 'number' : 'string', value: numeric ? Number(value) : value });
    }
  });
  return { sheet: range.sheet, cells: writes };
}

export function assertCategoryWorkbookSource(state: Values, parts: Readonly<Record<string, Uint8Array>>, map: WorkbookMap): void {
  // 删空系列只保留重建模板；其工作簿范围必须清空，模板不能声明未知单元格的所有权。
  if (!Object.values(state.series).some(series => !series.removed && series.bindings.categories?.hierarchy)) return;
  const binding = categoryBinding(state);
  if (!binding?.hierarchy) return;
  const range = parseChartFormula(binding.formula)!;
  const cells = sheetCells(parts, map, range.sheet);
  const shared = map.sharedStrings ? children(parseXmlTree(parts[map.sharedStrings]).root, 'si').map(text) : [];
  const categories = orderedChartRecords(Object.values(state.categories).filter(category => !category.removed));
  const resolved = resolvedCategoryLevels(categories, binding.hierarchy.levels);
  const valueOf = (cell: XmlElement | undefined): string | number | null => {
    if (!cell || !child(cell, 'v') && !child(cell, 'is')) return null;
    const type = attr(cell, 't'), raw = text(child(cell, 'v'));
    if (type === 'inlineStr') return text(child(cell, 'is'));
    if (type === 's' && /^\d+$/.test(raw) && Number(raw) < shared.length) return shared[Number(raw)];
    if ((type === null || type === 'n') && raw.trim() && Number.isFinite(Number(raw))) return Number(raw);
    throw new Error('多级类别工作簿含无法恢复的单元格类型');
  };
  categories.forEach((category, point) => {
    for (let level = 0; level < binding.hierarchy!.levels; level++) {
      const location = address(binding, point, level), value = valueOf(cells.get(location));
      const raw = category.levels?.[level] ?? null;
      const expected = raw ?? (level < binding.hierarchy!.levels - 1 ? resolved[point][level] : null);
      if (raw === null && value === null) continue;
      if (expected === null || value === null || String(value) !== expected) {
        throw new Error(`多级类别缓存与工作簿 ${range.sheet}!${location} 不一致`);
      }
    }
  });
}
