import { fractionalIndexBetween } from '@web-ppt/edit-core';
import type { ChartDatasetState, ChartPointId } from './types';
import type { SharedGroup } from './shared-graph';
import type { XYResource } from './shared-xy-records';
import { xyRecordLayout } from './shared-xy-records';
import { sharedXYFamilyByKey, xyOwnersForState } from './shared-xy-family';
import { assertInsertedRoom } from './shared-inserted-layout';
import { orderedChartRecords } from './ordering';
import { chartFormula, parseChartFormula } from './formula';
import { reconcileCategoryMatrix } from './category-matrix';
import { MAX_CHART_POINTS } from './limits';
import type { WorkbookCellValue } from './workbook-read';
import { jointXYRecords } from './shared-joint-records';

/** 每个视图只取自身来源范围内的插入；共享记录的坐标和身份由整条轴统一决定。 */
export function projectSharedXY(shared: SharedGroup, state: ChartDatasetState, original: ChartDatasetState,
  resource: XYResource, baseline: ReadonlyMap<string, WorkbookCellValue>): void {
  const records = Object.entries(resource.xyRecords ?? {}).map(([key, record]) => ({ family: sharedXYFamilyByKey(shared, key), record }));
  records.push(...jointXYRecords(shared, resource));
  if (!records.length) return;
  for (const { family, record } of records) {
    const layout = xyRecordLayout(family, record);
    assertInsertedRoom(shared, family, layout, baseline);
    for (const owner of xyOwnersForState(family, original)) {
      const source = original.series[owner.seriesId], series = state.series[owner.seriesId];
      const points = orderedChartRecords(Object.values(source.points));
      const selected = layout.records.filter(row => owner.positions.size
        ? row.anchor >= owner.start && row.anchor <= owner.end : row.anchor === owner.start - 1);
      if (points.length + selected.length > MAX_CHART_POINTS) throw new Error('共享 XY 数据点超过安全上限');
      const groups = new Map<number, typeof selected>();
      for (const row of selected) {
        const group = groups.get(row.anchor) ?? []; group.push(row); groups.set(row.anchor, group);
      }
      for (const [id, axis] of owner.positions) if (record.removed?.[String(axis)]) {
        (series.points[id] as { removed?: true }).removed = true;
      }
      const insert = (anchor: number, previous: typeof points[number] | undefined, next: typeof points[number] | undefined) => {
        let order = previous?.order ?? null;
        for (const row of groups.get(anchor) ?? []) {
          order = fractionalIndexBetween(order, next?.order ?? null);
          const value = (field: 'x' | 'value' | 'size') => row.cells?.[String(owner.lanes.get(field))] as number | null | undefined;
          const id = row.id as ChartPointId;
          series.points[id] = { id, order, x: value('x') ?? null, value: value('value') ?? null,
            ...(series.plotKind === 'bubble' ? { size: value('size') ?? null } : {}), ...(row.removed ? { removed: true } : {}) };
        }
      };
      if (!points.length) insert(owner.start - 1, undefined, undefined);
      points.forEach((point, index) => insert(owner.positions.get(point.id)!, point, points[index + 1]));
      if (!layout.active.length && !layout.deleted.length) continue;
      const axes = [...owner.positions].filter(([id]) => !series.points[id].removed).map(([, axis]) => layout.originalAxis(axis));
      axes.push(...selected.filter(row => !row.removed).map(layout.insertedAxis));
      const first = axes.length ? Math.min(...axes) : layout.originalAxis(owner.start), last = axes.length ? Math.max(...axes) : first;
      for (const field of ['x', 'y', 'size'] as const) {
        const binding = source.bindings[field]; if (!binding) continue;
        const range = parseChartFormula(binding.formula)!;
        (series.bindings as Record<string, unknown>)[field] = { ...binding, formula: chartFormula({ ...range,
          ...(family.horizontal ? { startColumn: first, endColumn: last } : { startRow: first, endRow: last }) }) };
      }
    }
  }
  reconcileCategoryMatrix(state);
  if (state.binding.mode === 'readonly') throw new Error(state.binding.reason ?? '共享 XY 数据矩阵不可写');
}
