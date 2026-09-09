import type { ChartDatasetState } from './types';
import { MAX_CHART_CELLS } from './limits';
import { orderedChartRecords } from './ordering';
import { preserveCategorySpans } from './category-levels';

export function reconcileCategoryMatrix(state: ChartDatasetState): void {
  const categories = Object.values(state.categories);
  const seriesRecords = Object.values(state.series);
  const categoryBinding = seriesRecords.find(series => series.bindings.categories?.hierarchy
    || series.bindings.categories?.formula)?.bindings.categories;
  const hierarchy = categoryBinding?.hierarchy;
  if (hierarchy) for (const category of categories) {
    const levels = category.levels ?? [...Array<string | null>(hierarchy.levels - 1).fill(null), category.label];
    (category as { levels: readonly (string | null)[]; label: string }).levels = levels;
    (category as { label: string }).label = levels[levels.length - 1] ?? '';
  }
  if (categoryBinding) for (const series of seriesRecords) {
    if (series.plotKind === 'scatter' || series.plotKind === 'bubble') continue;
    (series.bindings as { categories: NonNullable<typeof series.bindings.categories> }).categories = {
      // 新增系列继承同一类别来源；混写 literal 和引用会使重开后的矩阵来源不一致。
      ...categoryBinding, ...(series.bindings.categories?.formula === null ? {} : series.bindings.categories),
    };
  }
  if (hierarchy) preserveCategorySpans(orderedChartRecords(categories), hierarchy.levels);
  const active = categories.filter((item) => !item.removed);
  const activeSeries = seriesRecords.filter((series) => !series.removed);
  const categorySeries = activeSeries.filter((series) =>
    series.plotKind !== 'scatter' && series.plotKind !== 'bubble');
  const xyCells = activeSeries.filter((series) =>
    series.plotKind === 'scatter' || series.plotKind === 'bubble')
    .reduce((sum, series) => sum + Object.values(series.points).filter((point) => !point.removed).length, 0);
  if (active.length * categorySeries.length + xyCells > MAX_CHART_CELLS) {
    state.binding = { ...state.binding, mode: 'readonly', reason: '图表数据矩阵超过安全上限' };
    return;
  }
  for (const series of seriesRecords) {
    if (series.removed) continue;
    if (series.plotKind === 'scatter' || series.plotKind === 'bubble') continue;
    for (const point of Object.values(series.points)) {
      const category = state.categories[point.id];
      if (!category || category.removed) (point as { removed?: true }).removed = true;
      else delete (point as { removed?: true }).removed;
    }
    for (const category of active) {
      if (series.points[category.id]) continue;
      series.points[category.id] = {
        id: category.id, order: category.order, value: null,
      };
    }
  }
}
