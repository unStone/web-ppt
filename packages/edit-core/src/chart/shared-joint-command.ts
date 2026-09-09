import { fractionalIndexBetween } from '@web-ppt/edit-core';
import type { EditDoc } from '../types';
import type { CommandPatches, DocumentExtensionPatch } from '../commands/types';
import type { ChartPointId, ChartSeriesId } from './types';
import type { SharedGroup } from './shared-graph';
import type { SharedCategoryFamily } from './shared-family';
import type { InsertedResource } from './shared-inserted-project';
import { projectInsertedCategories } from './shared-inserted-project';
import { insertedRows } from './shared-inserted-records';
import { projectSharedRows } from './shared-rows';
import { projectSharedXY } from './shared-xy-project';
import { stageSharedRecords } from './shared-record-stage';
import { removeSharedRecord } from './shared-record-remove';
import { currentChartDatasetState } from './source';
import { orderedChartRecords } from './ordering';
import type { SharedSeriesGrowth } from './shared-added-plan';
import { planAddedSeries } from './shared-added-plan';
import type { WorkbookCellValue } from './workbook-read';

export function jointPointCommand(doc: EditDoc, shared: SharedGroup, family: SharedCategoryFamily, chartId: string,
  seriesId: ChartSeriesId, pointId: ChartPointId, local: CommandPatches, origin: string,
  resource: InsertedResource & SharedSeriesGrowth, baseline: ReadonlyMap<string, WorkbookCellValue>): CommandPatches {
  const owner = family.xyOwners.find(owner => owner.chart.id === chartId && owner.seriesId === seriesId)!;
  const source = owner.chart.state.series[seriesId], records = insertedRows(family, resource.insertions);
  const removing = local.forward.some(patch => patch.path[9] === 'removed' && patch.op === 'set' && patch.value === true);
  if (removing && source.points[pointId]) {
    return removeSharedRecord(doc, shared, family, owner.positions.get(pointId)!, origin, resource, baseline);
  }
  const row = records.find(row => row.id === pointId), created = local.forward.some(patch => patch.path[9] === 'id');
  if (!row && !created) throw new Error('共享 XY 新增点缺少共同记录');
  const prefix = ['document', 'extensions', 'chart-shared', shared.workbook, 'insertions', family.key, pointId] as const;
  const forward: DocumentExtensionPatch[] = [], inverse: DocumentExtensionPatch[] = [];
  const add = (tail: readonly string[], value: unknown, previous: unknown) => {
    const path: DocumentExtensionPatch['path'] = [...prefix, ...tail];
    forward.push({ op: 'set', path, value, origin });
    inverse.unshift(previous === undefined ? { op: 'del', path, origin } : { op: 'set', path, value: previous, origin });
  };
  if (created) {
    const current = currentChartDatasetState(doc, chartId).series[seriesId];
    const points = orderedChartRecords(Object.values(current.points).filter(point => !point.removed)), last = points[points.length - 1];
    const prior = records.find(row => row.id === last?.id);
    const anchor = prior?.anchor ?? (last ? owner.positions.get(last.id) : undefined) ?? owner.end;
    const siblings = records.filter(row => row.anchor === anchor);
    add(['id'], pointId, undefined); add(['anchor'], anchor, undefined);
    add(['order'], fractionalIndexBetween(siblings[siblings.length - 1]?.order ?? null, null), undefined);
    add(['parent'], prior?.id ?? null, undefined);
    forward.push({ op: 'del', path: [...prefix, 'removed'], origin });
  }
  if (removing) add(['removed'], true, row?.removed);
  else {
    const values = new Map<number, unknown>();
    for (const patch of local.forward) {
      const field = String(patch.path[9]);
      if (patch.op !== 'set' || !['x', 'value', 'size'].includes(field)) continue;
      const lane = owner.lanes.get(field as 'x' | 'value' | 'size');
      if (lane === undefined) throw new Error('共享 XY 字段没有来源区域');
      if (values.has(lane) && values.get(lane) !== patch.value) throw new Error('同一共享 XY 单元格不能同时写入不同数值');
      values.set(lane, patch.value);
    }
    for (const [lane, value] of values) add(['cells', String(lane)], value, row?.cells?.[String(lane)]);
  }
  const next = { ...resource, insertions: stageSharedRecords(resource.insertions, forward) };
  for (const chart of new Set([...family.charts, ...family.xyOwners.map(owner => owner.chart)])) {
    const state = structuredClone(chart.state); projectSharedRows(state, next.rows);
    projectInsertedCategories(shared, state, chart.state, next, baseline);
    projectSharedXY(shared, state, chart.state, next, baseline);
    if (state.binding.mode === 'readonly') throw new Error(state.binding.reason ?? '共同记录不可写');
  }
  planAddedSeries(shared, next, baseline);
  return { forward, inverse: created ? [{ op: 'set', path: [...prefix, 'removed'], value: true, origin }] : inverse };
}
