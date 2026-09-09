import { fractionalIndexBetween } from '@web-ppt/edit-core';
import type { EditDoc } from '../types';
import type { CommandPatches, DocumentExtensionPatch } from '../commands/types';
import type { SharedGroup } from './shared-graph';
import type { WorkbookCellValue } from './workbook-read';
import type { ChartSeriesId, ChartPointId } from './types';
import { sharedXYFamily } from './shared-xy-family';
import { xyRecordLayout, validateXYRecords } from './shared-xy-records';
import type { XYResource, SharedXYRecords } from './shared-xy-records';
import { stageSharedRecords } from './shared-record-stage';
import { currentChartDatasetState } from './source';
import { orderedChartRecords } from './ordering';
import { planAddedSeries } from './shared-added-plan';
import type { SharedSeriesGrowth } from './shared-added-plan';
import { sharedCategoryForXY } from './shared-family';
import { jointPointCommand } from './shared-joint-command';

export function sharedXYCommand(doc: EditDoc, shared: SharedGroup, id: string, local: CommandPatches,
  origin: string, resource: XYResource & SharedSeriesGrowth, baseline: ReadonlyMap<string, WorkbookCellValue>): CommandPatches | undefined {
  const pointPatch = local.forward.find(patch => patch.path[5] === 'series' && patch.path[7] === 'points');
  if (!pointPatch) return;
  const source = shared.charts.find(chart => chart.id === id)!.state;
  const seriesId = pointPatch.path[6] as ChartSeriesId, pointId = pointPatch.path[8] as ChartPointId, series = source.series[seriesId];
  if (!series || series.plotKind !== 'scatter' && series.plotKind !== 'bubble') return;
  const removing = pointPatch.path[9] === 'removed';
  if (series.points[pointId] && !removing) return;
  const joint = sharedCategoryForXY(shared, id, seriesId);
  if (joint) return jointPointCommand(doc, shared, joint, id, seriesId, pointId, local, origin, resource, baseline);
  const family = sharedXYFamily(shared, id, seriesId), owner = family.owners.find(owner => owner.chart.id === id && owner.seriesId === seriesId)!;
  const record = resource.xyRecords?.[family.key] ?? {}, layout = xyRecordLayout(family, record);
  const prefix = ['document', 'extensions', 'chart-shared', shared.workbook, 'xyRecords', family.key] as const;
  const forward: DocumentExtensionPatch[] = [], inverse: DocumentExtensionPatch[] = [];
  const add = (tail: readonly string[], value: unknown, previous: unknown) => {
    const path: DocumentExtensionPatch['path'] = [...prefix, ...tail];
    forward.push({ op: 'set', path, value, origin });
    inverse.unshift(previous === undefined ? { op: 'del', path, origin } : { op: 'set', path, value: previous, origin });
  };
  const row = layout.records.find(row => row.id === pointId);
  const created = local.forward.some(patch => patch.path[9] === 'id');
  if (removing && series.points[pointId]) {
    const axis = String(owner.positions.get(pointId)!);
    add(['removed', axis], true, record.removed?.[axis]);
  } else {
    if (!row && !created) throw new Error('共享 XY 新增点缺少稳定记录');
    if (created) {
      const current = currentChartDatasetState(doc, id).series[seriesId];
      const points = orderedChartRecords(Object.values(current.points).filter(point => !point.removed)), last = points[points.length - 1];
      const prior = layout.records.find(row => row.id === last?.id);
      const anchor = prior?.anchor ?? (last ? owner.positions.get(last.id) : undefined) ?? owner.end;
      const siblings = layout.records.filter(row => row.anchor === anchor);
      add(['insertions', pointId, 'id'], pointId, undefined);
      add(['insertions', pointId, 'anchor'], anchor, undefined);
      add(['insertions', pointId, 'order'], fractionalIndexBetween(siblings[siblings.length - 1]?.order ?? null, null), undefined);
      forward.push({ op: 'del', path: [...prefix, 'insertions', pointId, 'removed'], origin });
    }
    if (removing) add(['insertions', pointId, 'removed'], true, row?.removed);
    else {
      const values = new Map<number, unknown>();
      for (const patch of local.forward) {
        const field = String(patch.path[9]);
        if (!['x', 'value', 'size'].includes(field) || patch.op !== 'set') continue;
        const lane = owner.lanes.get(field as 'x' | 'value' | 'size');
        if (lane === undefined) throw new Error('共享 XY 字段没有来源区域');
        if (values.has(lane) && values.get(lane) !== patch.value) throw new Error('同一共享 XY 单元格不能同时写入不同数值');
        values.set(lane, patch.value);
      }
      for (const [lane, value] of values) add(['insertions', pointId, 'cells', String(lane)], value, row?.cells?.[String(lane)]);
    }
  }
  const next = { ...resource, xyRecords: stageSharedRecords(resource.xyRecords, forward) as SharedXYRecords };
  validateXYRecords(shared, next.xyRecords); planAddedSeries(shared, next, baseline);
  return { forward, inverse: created ? [{ op: 'set', path: [...prefix, 'insertions', pointId, 'removed'], value: true, origin }] : inverse };
}
