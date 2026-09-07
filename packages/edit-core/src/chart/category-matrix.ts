import type { ChartDatasetState } from './types';
import { MAX_CHART_CELLS } from './limits';
import { orderedChartRecords } from './ordering';
import { preserveCategorySpans } from './category-levels';

export function reconcileCategoryMatrix(state: ChartDatasetState): void {
  const categories = Object.values(state.categories);
  const hierarchy = Object.values(state.series).find(series => series.bindings.categories?.hierarchy)
    ?.bindings.categories?.hierarchy;
  if (hierarchy) for (const category of categories) {
    const levels = category.levels ?? [...Array<string | null>(hierarchy.levels - 1).fill(null), category.label];
    (category as { levels: readonly (string | null)[]; label: string }).levels = levels;
    (category as { label: string }).label = levels[levels.length - 1] ?? '';
  }
  if (hierarchy) for (const series of Object.values(state.series)) {
    if (series.plotKind === 'scatter' || series.plotKind === 'bubble') continue;
    (series.bindings as { categories: NonNullable<typeof series.bindings.categories> }).categories = {
      ...series.bindings.categories!, hierarchy,
    };
  }
  if (hierarchy) preserveCategorySpans(orderedChartRecords(categories), hierarchy.levels);
  const active = categories.filter((item) => !item.removed);
  const activeSeries = Object.values(state.series).filter((series) => !series.removed);
  const categorySeries = activeSeries.filter((series) =>
    series.plotKind !== 'scatter' && series.plotKind !== 'bubble');
  const xyCells = activeSeries.filter((series) =>
    series.plotKind === 'scatter' || series.plotKind === 'bubble')
    .reduce((sum, series) => sum + Object.values(series.points).filter((point) => !point.removed).length, 0);
  if (active.length * categorySeries.length + xyCells > MAX_CHART_CELLS) {
    state.binding = { ...state.binding, mode: 'readonly', reason: '图表数据矩阵超过安全上限' };
    return;
  }
  for (const series of Object.values(state.series)) {
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
