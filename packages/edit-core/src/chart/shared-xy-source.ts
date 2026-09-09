import type { SharedGroup } from './shared-graph';
import type { ChartDatasetState, ChartPointId, ChartSeriesId } from './types';
import { parseChartFormula } from './formula';
import { rangeCells } from './workbook-range';
import { sharedCellAddress } from './shared-address';
import { workbookCellKey } from './workbook-read';

export interface SharedXYOwner {
  readonly chart: SharedGroup['charts'][number];
  readonly seriesId: ChartSeriesId;
  readonly references: ReadonlySet<string>;
}
export interface SharedXYAxisOwner extends SharedXYOwner {
  readonly positions: ReadonlyMap<ChartPointId, number>;
  readonly lanes: ReadonlyMap<'x' | 'value' | 'size', number>;
  readonly start: number;
  readonly end: number;
}
const descriptors = new WeakMap<SharedGroup, SharedXYOwner[]>();
export function xyOwners(shared: SharedGroup): SharedXYOwner[] {
  let owners = descriptors.get(shared);
  if (owners) return owners;
  owners = shared.charts.flatMap(chart => Object.values(chart.state.series).filter(series => !series.removed
    && (series.plotKind === 'scatter' || series.plotKind === 'bubble')).map(series => ({ chart, seriesId: series.id,
    references: new Set(['x', 'y', 'size'].flatMap(field => {
      const formula = series.bindings[field as 'x' | 'y' | 'size']?.formula, range = parseChartFormula(formula ?? null);
      return range ? rangeCells(formula!).map(cell => workbookCellKey(range.sheet, cell)) : [];
    })) })));
  descriptors.set(shared, owners); return owners;
}

/** 空缓存和已保存的系列模板仍可从各维度位置恢复方向，不依赖活跃消费者集合。 */
export function sharedXYAxis(series: ChartDatasetState['series'][ChartSeriesId]): { sheet: string; horizontal: boolean } {
  const bindings = Object.entries(series.bindings)
    .filter(([field]) => ['x', 'y', 'size'].includes(field)).map(([, binding]) => parseChartFormula(binding?.formula ?? null));
  if (!bindings.length || bindings.some(range => !range)) throw new Error('共享 XY 缺少可解释的数值向量');
  const ranges = bindings.filter(range => !!range), first = ranges[0];
  const horizontal = ranges.some(range => range.startColumn < range.endColumn)
    || !ranges.some(range => range.startRow < range.endRow) && ranges.every(range => range.startColumn === first.startColumn)
      && ranges.some(range => range.startRow !== first.startRow);
  if (!horizontal && !ranges.some(range => range.startRow < range.endRow)
    && !(ranges.every(range => range.startRow === first.startRow) && ranges.some(range => range.startColumn !== first.startColumn))) {
    throw new Error('共享 XY 记录方向不明确');
  }
  return { sheet: first.sheet, horizontal };
}

export function connectedXYOwners(shared: SharedGroup, chartId: string, seriesId: string) {
  const owners = xyOwners(shared), target = owners.find(owner => owner.chart.id === chartId && owner.seriesId === seriesId);
  if (!target) throw new Error('共享 XY 缺少来源系列');
  const selected = new Set([target]), references = new Set(target.references);
  for (let changed = true; changed;) {
    changed = false;
    for (const owner of owners) if (!selected.has(owner) && [...owner.references].some(key => references.has(key))) {
      selected.add(owner); owner.references.forEach(key => references.add(key)); changed = true;
    }
  }
  return { target, selected, references };
}

export function xyAxisOwners(owners: readonly SharedXYOwner[], sheet: string, horizontal: boolean) {
  const keys = new Set<string>(), lanes = new Set<number>(), axes = new Set<number>(), anchors = new Set<number>();
  const members = owners.map(owner => {
    const series = owner.chart.state.series[owner.seriesId], positions = new Map<ChartPointId, number>();
    const dimensions = new Map<'x' | 'value' | 'size', number>();
    let start = Infinity, end = 0;
    for (const [field, name] of [['x', 'x'], ['y', 'value'], ['size', 'size']] as const) {
      if (!series.bindings[field]) continue;
      const range = parseChartFormula(series.bindings[field]!.formula);
      if (!range || range.sheet !== sheet || (horizontal ? range.startRow !== range.endRow : range.startColumn !== range.endColumn)) {
        throw new Error('共享 XY 的各维度不在同一工作表记录轴上');
      }
      const axis = horizontal ? range.startColumn : range.startRow;
      const lane = horizontal ? range.startRow : range.startColumn;
      if (start !== Infinity && start !== axis) throw new Error('共享 XY 的各维度记录起点不一致');
      start = axis; dimensions.set(name, lane); lanes.add(lane);
    }
    for (const field of owner.chart.fields.filter(field => field.path[1] === owner.seriesId && field.path[2] === 'points')) {
      const cell = sharedCellAddress(field.key), axis = horizontal ? cell.column : cell.row, id = field.path[3] as ChartPointId;
      if (positions.has(id) && positions.get(id) !== axis) throw new Error('共享 XY 的数据点不在同一记录轴上');
      positions.set(id, axis); keys.add(field.key); axes.add(axis); anchors.add(axis); end = Math.max(end, axis);
    }
    if (!positions.size) { end = start - 1; anchors.add(end); }
    return { ...owner, positions, lanes: dimensions, start, end };
  });
  return { members, keys, lanes, axes, anchors };
}
