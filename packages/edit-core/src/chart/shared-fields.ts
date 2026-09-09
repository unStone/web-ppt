import type { ChartDatasetState } from './types';
import { columnName, parseChartFormula } from './formula';
import { rangeCells } from './workbook-range';
import { orderedChartRecords } from './ordering';
import { workbookCellKey } from './workbook-read';
import { resolvedCategoryLevels } from './category-levels';

export interface SharedCellField {
  readonly key: string;
  readonly path: readonly string[];
  readonly value: string | number | null;
  readonly kind: 'number' | 'text';
  readonly nullable?: boolean;
  readonly parent?: { readonly level: number; readonly raw: string | null; readonly family: string };
}

/** 混合图中的类别记录只拥有类别系列的数值；XY 系列按各自的记录轴增删。 */
export function sharedCategoryFields(state: ChartDatasetState, fields: readonly SharedCellField[] = sharedCellFields(state)): SharedCellField[] {
  return fields.filter(field => {
    if (field.path[0] === 'categories') return true;
    const series = state.series[field.path[1] as keyof typeof state.series];
    return field.path[2] === 'points' && series && series.plotKind !== 'scatter' && series.plotKind !== 'bubble';
  });
}

/** 空缓存也保留公式所有权，分配新系列不能占用这些仍可恢复的区域。 */
export function sharedFormulaCells(state: ChartDatasetState): string[] {
  return Object.values(state.series).flatMap(series => Object.values(series.bindings).flatMap(binding => {
    const range = parseChartFormula(binding?.formula ?? null);
    return range ? rangeCells(binding!.formula).map(cell => workbookCellKey(range.sheet, cell)) : [];
  }));
}

export function sharedCellFields(state: ChartDatasetState): SharedCellField[] {
  const result: SharedCellField[] = [];
  const add = (formula: string | null, paths: readonly (readonly string[])[], values: readonly (string | number | null)[], kind: SharedCellField['kind']) => {
    const range = parseChartFormula(formula);
    if (!range) return;
    rangeCells(formula).forEach((address, index) => {
      if (paths[index]) result.push({ key: workbookCellKey(range.sheet, address), path: paths[index], value: values[index], kind });
    });
  };
  const series = orderedChartRecords(Object.values(state.series).filter(series => !series.removed));
  for (const item of series) {
    add(item.bindings.name.formula, [['series', item.id, 'name']], [item.name], 'text');
    const points = orderedChartRecords(Object.values(item.points).filter(point => !point.removed));
    for (const [binding, field] of [['values', 'value'], ['y', 'value'], ['x', 'x'], ['size', 'size']] as const) {
      add(item.bindings[binding]?.formula ?? null,
        points.map(point => ['series', item.id, 'points', point.id, field]), points.map(point => point[field] ?? null), 'number');
    }
  }
  const binding = series.find(item => item.bindings.categories)?.bindings.categories;
  const categories = orderedChartRecords(Object.values(state.categories).filter(category => !category.removed));
  const range = parseChartFormula(binding?.formula ?? null);
  if (range && binding?.hierarchy) {
    const depth = binding.hierarchy.levels;
    const horizontal = binding.hierarchy.orientation === 'columns';
    const resolved = resolvedCategoryLevels(categories, depth);
    const family = `${workbookCellKey(range.sheet, `${columnName(range.startColumn)}${range.startRow}`)}:${depth}:${binding.hierarchy.orientation}`;
    categories.forEach((category, index) => {
      for (let level = 0; level < depth; level++) result.push({
        key: workbookCellKey(range.sheet, `${columnName(range.startColumn + (horizontal ? index : level))}${range.startRow + (horizontal ? level : index)}`),
        path: ['categories', category.id, 'levels', String(level)],
        value: level < depth - 1 ? resolved[index][level] : category.levels?.[level] ?? null,
        kind: 'text', nullable: true,
        ...(level < depth - 1 ? { parent: { level, raw: category.levels?.[level] ?? null, family } } : {}),
      });
    });
  } else add(binding?.formula ?? null, categories.map(category => ['categories', category.id, 'label']), categories.map(category => category.label), 'text');
  return result;
}
