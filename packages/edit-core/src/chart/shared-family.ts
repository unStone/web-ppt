import type { SharedGroup } from './shared-graph';
import type { ChartDatasetState } from './types';
import { parseChartFormula } from './formula';
import { sharedCellAddress } from './shared-address';
import { sharedCategoryFields } from './shared-fields';
import { connectedXYOwners, xyOwners, xyAxisOwners } from './shared-xy-source';
import type { SharedXYAxisOwner } from './shared-xy-source';
import { rangeCells } from './workbook-range';
import { workbookCellKey } from './workbook-read';

export interface SharedCategoryFamily {
  readonly key: string;
  readonly sheet: string;
  readonly horizontal: boolean;
  readonly start: number;
  readonly end: number;
  readonly lanes: ReadonlySet<number>;
  readonly keys: ReadonlySet<string>;
  readonly charts: SharedGroup['charts'];
  readonly positions: ReadonlyMap<string, ReadonlyMap<string, number>>;
  readonly xyOwners: readonly SharedXYAxisOwner[];
  readonly ranges: ReadonlyMap<string, { readonly start: number; readonly end: number }>;
  readonly anchors: ReadonlySet<number>;
  readonly numericLanes: ReadonlySet<number>;
}
const families = new WeakMap<SharedGroup, Map<string, SharedCategoryFamily>>();
const data = (chart: SharedGroup['charts'][number]) => sharedCategoryFields(chart.state, chart.fields);
const referenceCache = new WeakMap<SharedGroup['charts'][number], string[]>();
const references = (chart: SharedGroup['charts'][number]) => {
  const cached = referenceCache.get(chart); if (cached) return cached;
  const result = Object.values(chart.state.series).flatMap(series => {
  if (series.removed || !series.bindings.categories) return [];
  return [series.bindings.categories, series.bindings.values].flatMap(binding => {
    const range = parseChartFormula(binding?.formula ?? null);
    return range ? rangeCells(binding!.formula).map(cell => workbookCellKey(range.sheet, cell)) : [];
  });
  });
  referenceCache.set(chart, result); return result;
};

function horizontalCategory(chart: SharedGroup['charts'][number]): boolean {
  const bindings = Object.values(chart.state.series).filter(series => !series.removed && series.bindings.categories);
  const category = bindings[0]?.bindings.categories;
  if (category?.hierarchy) return category.hierarchy.orientation === 'columns';
  const ranges = bindings.flatMap(series => [series.bindings.categories, series.bindings.values])
    .map(binding => parseChartFormula(binding?.formula ?? null)).filter(range => !!range);
  if (ranges.some(range => range.startColumn < range.endColumn)) return true;
  if (ranges.some(range => range.startRow < range.endRow)) return false;
  // 删空后公式只剩单格锚点，类别与数值通道的相对位置仍保留横向记录轴。
  return ranges.length > 1 && ranges.every(range => range.startColumn === ranges[0].startColumn)
    && ranges.some(range => range.startRow !== ranges[0].startRow);
}

/** 相交的数据单元格把视图组成一个记录轴；框架身份不会改变这个区域的所有权。 */
export function sharedCategoryFamily(shared: SharedGroup, id: string): SharedCategoryFamily {
  let cache = families.get(shared);
  if (!cache) { cache = new Map(); families.set(shared, cache); }
  const cached = cache.get(id);
  if (cached) return cached;
  const target = shared.charts.find(chart => chart.id === id);
  if (!target) throw new Error('共享类别缺少来源图表');
  const selected = new Set([id]), keys = new Set(references(target));
  const xy = new Set<ReturnType<typeof xyOwners>[number]>();
  for (let changed = true; changed;) {
    changed = false;
    for (const chart of shared.charts) if (!selected.has(chart.id) && references(chart).some(key => keys.has(key))) {
      selected.add(chart.id); references(chart).forEach(key => keys.add(key)); changed = true;
    }
    for (const owner of xyOwners(shared)) if (!xy.has(owner) && [...owner.references].some(key => keys.has(key))) {
      xy.add(owner); owner.references.forEach(key => keys.add(key)); changed = true;
    }
  }
  const charts = shared.charts.filter(chart => selected.has(chart.id));
  for (const chart of shared.charts) {
    const owned = new Set(data(chart));
    if (chart.fields.some(field => keys.has(field.key) && !owned.has(field)
      && ![...xy].some(owner => owner.chart === chart && field.path[1] === owner.seriesId && field.path[2] === 'points'))) {
      throw new Error('共享类别记录与 XY 或名称区域重叠，不能无歧义增删');
    }
  }
  const binding = Object.values(target.state.series).find(series => series.bindings.categories)?.bindings.categories;
  const range = parseChartFormula(binding?.formula ?? null);
  if (!range) throw new Error('共享类别没有可解释的行绑定');
  const horizontal = horizontalCategory(target);
  const lanes = new Set<number>(), positions = new Map<string, Map<string, number>>();
  const ranges = new Map<string, { start: number; end: number }>(), anchors = new Set<number>();
  const numericLanes = new Set<number>();
  let start = Infinity, end = 0;
  for (const chart of charts) {
    const known = new Map<string, number>(); positions.set(chart.id, known);
    const reference = Object.values(chart.state.series).find(series => series.bindings.categories)?.bindings.categories;
    const rectangle = parseChartFormula(reference?.formula ?? null)!;
    const first = horizontal ? rectangle.startColumn : rectangle.startRow;
    if (horizontalCategory(chart) !== horizontal) throw new Error('共享类别与数值不在同一工作表记录轴上');
    for (const series of Object.values(chart.state.series)) if (!series.removed && series.bindings.categories) {
      const values = parseChartFormula(series.bindings.values?.formula ?? null);
      if (values && (horizontal ? values.startRow !== values.endRow || values.startColumn !== first
        : values.startColumn !== values.endColumn || values.startRow !== first)) {
        throw new Error('共享类别与数值不在同一工作表记录轴上');
      }
      if (values) numericLanes.add(horizontal ? values.startRow : values.startColumn);
    }
    for (const key of references(chart)) {
      const cell = sharedCellAddress(key);
      if (cell.sheet !== range.sheet) throw new Error('共享类别与数值不在同一工作表记录轴上');
      lanes.add(horizontal ? cell.row : cell.column);
    }
    for (const field of data(chart)) {
      const cell = sharedCellAddress(field.key), axis = horizontal ? cell.column : cell.row;
      const category = field.path[0] === 'categories' ? field.path[1] : field.path[3];
      if (cell.sheet !== range.sheet || known.has(category) && known.get(category) !== axis) {
        throw new Error('共享类别与数值不在同一工作表记录轴上');
      }
      known.set(category, axis); lanes.add(horizontal ? cell.row : cell.column);
      start = Math.min(start, axis); end = Math.max(end, axis);
      anchors.add(axis);
    }
    const bounds = { start: known.size ? Math.min(...known.values()) : first,
      end: known.size ? Math.max(...known.values()) : first - 1 };
    ranges.set(chart.id, bounds); start = Math.min(start, bounds.start); end = Math.max(end, bounds.end);
    if (!known.size) anchors.add(bounds.end);
  }
  const geometry = xyAxisOwners([...xy], range.sheet, horizontal);
  geometry.lanes.forEach(lane => lanes.add(lane));
  geometry.lanes.forEach(lane => numericLanes.add(lane));
  geometry.anchors.forEach(anchor => anchors.add(anchor));
  for (const owner of geometry.members) { start = Math.min(start, owner.start); end = Math.max(end, owner.end); }
  if (!Number.isFinite(start) || !lanes.size) throw new Error('共享类别没有可作为插入锚点的来源记录');
  const key = [...keys].sort()[0];
  const result = { key, sheet: range.sheet, horizontal, start, end, lanes, keys, charts, positions, ranges, anchors, numericLanes, xyOwners: geometry.members };
  for (const chart of charts) cache.set(chart.id, result);
  return result;
}

export function sharedCategoryForXY(shared: SharedGroup, chartId: string, seriesId: string): SharedCategoryFamily | undefined {
  const connected = connectedXYOwners(shared, chartId, seriesId);
  const category = shared.charts.find(chart => references(chart).some(key => connected.references.has(key)));
  return category ? sharedCategoryFamily(shared, category.id) : undefined;
}

export function sharedFamilyForState(shared: SharedGroup, state: ChartDatasetState): SharedCategoryFamily {
  const owner = shared.charts.find(chart => chart.state.binding.chartPart === state.binding.chartPart
    && Object.keys(chart.state.categories).every(id => state.categories[id as keyof typeof state.categories]));
  if (!owner) throw new Error('共享类别没有对应的来源身份');
  return sharedCategoryFamily(shared, owner.id);
}

export function sharedFamilyByKey(shared: SharedGroup, key: string): SharedCategoryFamily {
  const chart = shared.charts.find(chart => references(chart).includes(key));
  const xy = chart ? undefined : xyOwners(shared).find(owner => owner.references.has(key));
  const family = chart ? sharedCategoryFamily(shared, chart.id) : xy && sharedCategoryForXY(shared, xy.chart.id, xy.seriesId);
  if (family?.key === key) return family;
  throw new Error('共享新增类别不属于此工作簿记录轴');
}
