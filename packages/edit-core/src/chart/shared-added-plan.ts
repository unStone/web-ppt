import type { ChartDatasetState, ChartSeriesId } from './types';
import type { SharedGroup } from './shared-graph';
import type { WorkbookCellValue } from './workbook-read';
import { parseChartFormula } from './formula';
import { projectSharedRows } from './shared-rows';
import { mergeChartDatasetState } from './dataset-merge';
import { projectSharedSeries } from './shared-series';
import type { SharedSeriesRemovals } from './shared-series';
import { decodeAddedSeries } from './shared-added-records';
import type { AddedSeries } from './shared-added-records';
import { sharedSeriesAllocator } from './shared-allocate';
import { projectInsertedCategories } from './shared-inserted-project';
import type { InsertedResource } from './shared-inserted-project';
import { sharedFormulaCells } from './shared-fields';
import { sharedXYAxis } from './shared-xy-family';
import { assertSharedGrowthSpace } from './shared-growth-space';
import { projectSharedXY } from './shared-xy-project';
import type { XYResource } from './shared-xy-records';

export interface SharedSeriesGrowth extends InsertedResource, XYResource {
  readonly addedSeries?: AddedSeries;
  readonly rows?: Readonly<Record<string, unknown>>;
  readonly series?: SharedSeriesRemovals;
}
export interface AddedSeriesPlan {
  readonly part: string;
  readonly id: ChartSeriesId;
  readonly state: ChartDatasetState;
}

/** 物理列/行由整个工作簿统一分配；文档存储的身份和数值不会随并发插入挪动。 */
export function planAddedSeries(shared: SharedGroup, resource: SharedSeriesGrowth,
  baseline: ReadonlyMap<string, WorkbookCellValue>): AddedSeriesPlan[] {
  assertSharedGrowthSpace(shared, resource);
  const states = new Map<string, ChartDatasetState>();
  for (const chart of shared.charts) {
    const part = chart.state.binding.chartPart;
    if (states.has(part)) continue;
    const source = structuredClone(chart.state);
    projectSharedRows(source, resource.rows); projectSharedSeries(source, resource.series);
    projectInsertedCategories(shared, source, chart.state, resource, baseline);
    projectSharedXY(shared, source, chart.state, resource, baseline);
    const merged = mergeChartDatasetState(source, decodeAddedSeries(chart.state, resource.addedSeries));
    if (merged.deferred) throw new Error('共享新增系列字段尚未完整或不满足数据约束');
    states.set(part, merged.state);
  }
  const plans = [...states].flatMap(([part, state]) => {
    const source = shared.charts.find(chart => chart.state.binding.chartPart === part)!.state;
    return Object.values(state.series).filter(series => !source.series[series.id]).map(series => ({ part, id: series.id, state }));
  }).sort((a, b) => a.part < b.part ? -1 : a.part > b.part ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const reserved = new Set(shared.charts.flatMap(chart => sharedFormulaCells(chart.state)));
  for (const state of states.values()) for (const key of sharedFormulaCells(state)) reserved.add(key);
  const allocate = sharedSeriesAllocator(reserved, baseline);
  for (const plan of plans) {
    const { state, id } = plan, series = state.series[id];
    if (state.binding.mode === 'readonly') throw new Error(state.binding.reason ?? '共享数据矩阵不可写');
    const xy = series.plotKind === 'scatter' || series.plotKind === 'bubble';
    const source = shared.charts.find(chart => chart.state.binding.chartPart === plan.part)!.state;
    const template = Object.values(state.series).find(item => source.series[item.id] && item.plotKind === series.plotKind
      && (xy ? item.bindings.x?.formula : item.bindings.values?.formula));
    const range = parseChartFormula((xy ? template?.bindings.x?.formula : template?.bindings.values?.formula) ?? null);
    if (!range) throw new Error('共享新增系列没有可解释的数据区域');
    const horizontal = xy ? sharedXYAxis(source.series[template!.id]).horizontal
      : template?.bindings.categories?.hierarchy?.orientation === 'columns'
        || !template?.bindings.categories?.hierarchy && range.startRow === range.endRow && range.startColumn < range.endColumn;
    const start = horizontal ? range.startColumn : range.startRow;
    const count = Math.max(1, Object.values(xy ? series.points : state.categories).filter(item => !item.removed).length);
    const first = allocate(range.sheet, horizontal, start, count);
    state.series[id] = { ...series, bindings: xy ? { ...series.bindings, name: first.name, x: first.data,
      y: allocate(range.sheet, horizontal, start, count).data,
      ...(series.plotKind === 'bubble' ? { size: allocate(range.sheet, horizontal, start, count).data } : {}) }
      : { ...series.bindings, name: first.name, values: first.data, categories: template!.bindings.categories } };
  }
  return plans;
}
