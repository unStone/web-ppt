import { fractionalIndexBetween } from '@web-ppt/edit-core';
import type { EditDoc } from '../types';
import type { CommandPatches, DocumentExtensionPatch } from '../commands/types';
import type { SharedGroup } from './shared-graph';
import { sharedCategoryFamily } from './shared-family';
import { insertedRows } from './shared-inserted-records';
import { projectInsertedCategories } from './shared-inserted-project';
import type { InsertedResource } from './shared-inserted-project';
import { currentChartDatasetState } from './source';
import { orderedChartRecords } from './ordering';
import { parseChartFormula } from './formula';
import { stageSharedRecords } from './shared-record-stage';
import { projectSharedRows } from './shared-rows';
import type { WorkbookCellValue } from './workbook-read';
import { addedSeriesCommand } from './shared-added-records';
import { planAddedSeries } from './shared-added-plan';
import type { SharedSeriesGrowth } from './shared-added-plan';
import { projectSharedXY } from './shared-xy-project';

export function insertedCategoryCommand(doc: EditDoc, shared: SharedGroup, id: string, local: CommandPatches,
  origin: string, resource: InsertedResource & SharedSeriesGrowth,
  baseline: ReadonlyMap<string, WorkbookCellValue>): CommandPatches | undefined {
  const source = shared.charts.find(chart => chart.id === id)!.state;
  if (source.kind === 'xy') return;
  const categoryPatch = local.forward.find(patch => patch.path[5] === 'categories');
  const pointPatch = local.forward.find(patch => patch.path[5] === 'series' && patch.path[7] === 'points'
    && source.series[patch.path[6] as keyof typeof source.series]?.bindings.categories);
  const categoryId = String(categoryPatch?.path[6] ?? pointPatch?.path[8] ?? '');
  if (!categoryId || categoryId in source.categories) return;
  const family = sharedCategoryFamily(shared, id), records = insertedRows(family, resource.insertions);
  const row = records.find(row => row.id === categoryId);
  const created = local.forward.some(patch => patch.path[5] === 'categories' && patch.path[7] === 'id' && patch.op === 'set');
  if (!row && !created) throw new Error('共享类别没有稳定的新增记录');
  const prefix = ['document', 'extensions', 'chart-shared', shared.workbook, 'insertions', family.key, categoryId] as const;
  const forward: DocumentExtensionPatch[] = [], inverse: DocumentExtensionPatch[] = [];
  const add = (tail: readonly string[], value: unknown, previous: unknown) => {
    const path: DocumentExtensionPatch['path'] = [...prefix, ...tail];
    forward.push({ op: 'set', path, value, origin });
    inverse.unshift(previous === undefined ? { op: 'del', path, origin } : { op: 'set', path, value: previous, origin });
  };
  if (created) {
    const current = currentChartDatasetState(doc, id);
    const visible = orderedChartRecords(Object.values(current.categories).filter(category => !category.removed));
    const last = visible[visible.length - 1];
    const prior = records.find(row => row.id === last?.id);
    const anchor = prior?.anchor ?? (last ? family.positions.get(id)?.get(last.id) : undefined) ?? family.ranges.get(id)!.end;
    const siblings = records.filter(row => row.anchor === anchor);
    const order = fractionalIndexBetween(siblings[siblings.length - 1]?.order ?? null, null);
    add(['id'], categoryId, undefined); add(['anchor'], anchor, undefined); add(['order'], order, undefined);
    add(['parent'], prior?.id ?? null, undefined);
    forward.push({ op: 'del', path: [...prefix, 'removed'], origin });
  } else if (categoryPatch?.path[7] === 'removed') {
    add(['removed'], true, row?.removed);
    return { forward, inverse };
  }
  const binding = Object.values(source.series).find(series => series.bindings.categories)?.bindings.categories;
  const range = parseChartFormula(binding?.formula ?? null)!;
  const lane = family.horizontal ? range.startRow : range.startColumn;
  for (const patch of local.forward) {
    if (patch.op !== 'set') continue;
    if (patch.path[5] === 'categories') {
      const field = patch.path[7];
      if (field === 'label' && !binding?.hierarchy || field === 'levels') {
        const key = String(lane + (field === 'levels' ? Number(patch.path[8]) : 0));
        add(['cells', key], patch.value, row?.cells?.[key]);
      }
    } else if (patch.path[7] === 'points' && patch.path[9] === 'value' && String(patch.path[6]) in source.series) {
      const series = source.series[patch.path[6] as keyof typeof source.series];
      const range = parseChartFormula(series.bindings.values?.formula ?? null);
      if (!range) throw new Error('共享系列没有数值记录轴');
      const key = String(family.horizontal ? range.startRow : range.startColumn);
      add(['cells', key], patch.value, row?.cells?.[key]);
    }
  }
  const extra = local.forward.filter(patch => patch.path[5] === 'series' && !(String(patch.path[6]) in source.series)
    && patch.path[7] === 'points' && patch.path[9] === 'value');
  if (extra.length) forward.push(...addedSeriesCommand(source, shared.workbook, { forward: extra, inverse: [] })!.forward as DocumentExtensionPatch[]);
  const next = { ...resource,
    insertions: stageSharedRecords(resource.insertions, forward.filter(patch => patch.path[4] === 'insertions')),
    addedSeries: extra.length ? stageSharedRecords(resource.addedSeries, forward.filter(patch => patch.path[4] === 'addedSeries')) : resource.addedSeries };
  for (const chart of new Set([...family.charts, ...family.xyOwners.map(owner => owner.chart)])) {
    const state = structuredClone(chart.state); projectSharedRows(state, resource.rows);
    projectInsertedCategories(shared, state, chart.state, next, baseline);
    projectSharedXY(shared, state, chart.state, next, baseline);
    if (state.binding.mode === 'readonly') throw new Error(state.binding.reason ?? '共享类别矩阵不可写');
  }
  planAddedSeries(shared, next, baseline);
  return { forward, inverse: created ? [{ op: 'set', path: [...prefix, 'removed'], value: true, origin }] : inverse };
}
