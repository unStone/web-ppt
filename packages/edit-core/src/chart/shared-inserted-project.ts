import { fractionalIndexBetween } from '@web-ppt/edit-core';
import type { ChartCategory, ChartDatasetState, ChartPointId } from './types';
import type { SharedGroup } from './shared-graph';
import type { InsertedRows } from './shared-inserted-records';
import { sharedFamilyForState } from './shared-family';
import { assertInsertedRoom, insertedRowLayout } from './shared-inserted-layout';
import type { RemovedCells } from './shared-rows';
import { sharedCellAddress } from './shared-rows';
import type { WorkbookCellValue } from './workbook-read';
import { parseChartFormula, chartFormula } from './formula';
import { reconcileCategoryMatrix } from './category-matrix';
import { orderedChartRecords } from './ordering';
import { decodeSharedCell, sharedCellValue } from './shared-cell';
import { insertedCellOverrides, insertedCellKey, insertedCellReference } from './shared-inserted-cells';
import type { InsertedCellResource } from './shared-inserted-cells';
import { MAX_CHART_CELLS, MAX_CHART_POINTS } from './limits';

export interface InsertedResource extends InsertedCellResource { readonly insertions?: InsertedRows; readonly rows?: RemovedCells }

/** 插入顺序投影到每个视图的本地分数序；工作簿坐标只在保存边界派生。 */
export function projectInsertedCategories(shared: SharedGroup, state: ChartDatasetState,
  original: ChartDatasetState, resource: InsertedResource, baseline: ReadonlyMap<string, WorkbookCellValue>): void {
  if (!resource.insertions || original.kind === 'xy') return;
  const family = sharedFamilyForState(shared, original);
  const layout = insertedRowLayout(family, resource.insertions, resource.rows);
  if (!layout.records.length) return;
  assertInsertedRoom(shared, family, layout, baseline);
  const owner = family.charts.find(chart => chart.state === original || chart.state.binding.chartPart === original.binding.chartPart
    && Object.keys(chart.state.categories).every(id => id in original.categories))!;
  const positions = family.positions.get(owner.id)!;
  const sourceCategories = orderedChartRecords(Object.values(original.categories));
  const { start, end } = family.ranges.get(owner.id)!;
  const binding = Object.values(original.series).find(series => series.bindings.categories)?.bindings.categories;
  const range = parseChartFormula(binding?.formula ?? null)!;
  const depth = binding?.hierarchy?.levels;
  const firstLane = family.horizontal ? range.startRow : range.startColumn;
  const selected = layout.records.filter(row => positions.size ? row.anchor >= start && row.anchor <= end : row.anchor === end);
  if (sourceCategories.length + selected.length > MAX_CHART_POINTS
    || (sourceCategories.length + selected.length) * (depth ?? 1) > MAX_CHART_CELLS) throw new Error('共享类别或层级总量超过安全上限');
  const cells = insertedCellOverrides(shared, resource), forced = new Set<string>();
  const rowsByAnchor = new Map<number, typeof selected>();
  const selectedIds = new Set(selected.map(row => row.id));
  for (const row of selected) {
    const rows = rowsByAnchor.get(row.anchor) ?? []; rows.push(row); rowsByAnchor.set(row.anchor, rows);
  }
  const fieldsByCategory = new Map<string, typeof owner.fields[number][]>();
  for (const field of owner.fields) if (field.parent) {
    const fields = fieldsByCategory.get(field.path[1]) ?? []; fields.push(field); fieldsByCategory.set(field.path[1], fields);
  }
  const insert = (anchor: number, source?: ChartCategory, next?: ChartCategory) => {
    const rows = rowsByAnchor.get(anchor) ?? [];
    let previous = source;
    for (const row of rows) {
      const id = row.id as ChartPointId, order = fractionalIndexBetween(previous?.order ?? null, next?.order ?? null);
      const levels = depth ? Array.from({ length: depth }, (_, level) => {
        const value = row.cells?.[String(firstLane + level)]; return value === undefined || value === null ? null : String(value);
      }) : undefined;
      const value = sharedCellValue(insertedCellKey(row.id, firstLane), cells, baseline);
      const label = levels ? levels[levels.length - 1] ?? '' : String(value ?? '');
      const category: ChartCategory = { id, order, label, ...(levels ? { levels, levelParent: (row.parent ?? source?.id ?? null) as ChartPointId | null } : {}),
        ...(row.removed ? { removed: true } : {}) };
      state.categories[id] = category;
      for (const series of Object.values(state.series)) {
        if (series.plotKind === 'scatter' || series.plotKind === 'bubble') continue;
        const sourceRange = parseChartFormula(original.series[series.id]?.bindings.values?.formula ?? null);
        if (!sourceRange) continue;
        const lane = family.horizontal ? sourceRange.startRow : sourceRange.startColumn;
        const value = row.cells?.[String(lane)];
        series.points[id] = { id, order, value: typeof value === 'number' ? value : null, ...(row.removed ? { removed: true } : {}) };
      }
      previous = category;
    }
  };
  if (!sourceCategories.length) insert(end);
  let previousSource: ChartPointId | null = null;
  for (let index = 0; index < sourceCategories.length; index++) {
    const source = sourceCategories[index], current = state.categories[source.id];
    for (const field of fieldsByCategory.get(source.id) ?? []) {
      const raw = resource.cells?.[field.key]; if (raw === undefined) continue;
      const value = decodeSharedCell(raw), ref = 'parent' in value ? insertedCellReference(value.parent) : undefined;
      if (!ref || !selectedIds.has(ref.id)) continue;
      const level = field.parent!.level;
      (current as { levels: readonly (string | null)[] }).levels = current.levels!.map((value, index) => index === level ? null : value);
      (current as { levelClears: Readonly<Record<string, ChartPointId>> }).levelClears = { ...current.levelClears, [level]: ref.id as ChartPointId };
      forced.add(current.id);
    }
    (current as { levelParent?: ChartPointId | null }).levelParent = previousSource;
    previousSource = source.id;
    insert(positions.get(source.id)!, current, sourceCategories[index + 1]);
  }
  reconcileCategoryMatrix(state);
  // 组首提升已投影成自足的显示槽；后续矩阵物化不应再让已删的新组改变来源跨度。
  for (const category of Object.values(state.categories)) {
    delete (category as { levelParent?: ChartPointId | null }).levelParent;
    if (forced.has(category.id)) {
      delete (category as { levelClears?: unknown }).levelClears;
      if (original.categories[category.id].levelClears) (category as { levelClears?: unknown }).levelClears = original.categories[category.id].levelClears;
    }
    if (!(category.id in original.categories) && category.removed && category.levels) {
      (category as { levels: readonly null[] }).levels = Array(category.levels.length).fill(null);
    }
  }
  if (!layout.active.length) return;
  const axes = sourceCategories.filter(category => !state.categories[category.id].removed)
    .map(category => layout.originalAxis(positions.get(category.id)!));
  axes.push(...selected.filter(row => !row.removed).map(layout.insertedAxis));
  const first = axes.length ? Math.min(...axes) : layout.originalAxis(start), last = axes.length ? Math.max(...axes) : first;
  for (const series of Object.values(state.series)) {
    if (series.plotKind === 'scatter' || series.plotKind === 'bubble') continue;
    const source = original.series[series.id]; if (!source) continue;
    for (const [field, binding] of Object.entries(source.bindings)) {
      if (field === 'name') continue;
      const range = parseChartFormula(binding?.formula ?? null); if (!range) continue;
      (series.bindings as Record<string, unknown>)[field] = { ...binding, formula: chartFormula({ ...range,
        ...(family.horizontal ? { startColumn: first, endColumn: last } : { startRow: first, endRow: last }) }) };
    }
  }
}

export function insertedCellLane(family: ReturnType<typeof sharedFamilyForState>, key: string): string {
  const cell = sharedCellAddress(key); return String(family.horizontal ? cell.row : cell.column);
}
