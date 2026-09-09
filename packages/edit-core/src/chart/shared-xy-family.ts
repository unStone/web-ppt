import type { SharedGroup } from './shared-graph';
import type { ChartDatasetState } from './types';
import type { SharedRecordAxis } from './shared-record-axis';
import { columnName } from './formula';
import { workbookCellKey } from './workbook-read';
import { connectedXYOwners, xyOwners, xyAxisOwners, sharedXYAxis } from './shared-xy-source';
import type { SharedXYOwner, SharedXYAxisOwner } from './shared-xy-source';
export { sharedXYAxis } from './shared-xy-source';
export type { SharedXYOwner, SharedXYAxisOwner } from './shared-xy-source';

export interface SharedXYFamily extends SharedRecordAxis {
  readonly owners: readonly SharedXYAxisOwner[];
  readonly identities: ReadonlySet<string>;
  readonly positions: ReadonlySet<number>;
  readonly anchors: ReadonlySet<number>;
}

const cache = new WeakMap<SharedGroup, Map<SharedXYOwner, SharedXYFamily>>();
export function sharedXYFamily(shared: SharedGroup, chartId: string, seriesId: string): SharedXYFamily {
  const { target, selected, references } = connectedXYOwners(shared, chartId, seriesId);
  let entries = cache.get(shared);
  if (!entries) { entries = new Map(); cache.set(shared, entries); }
  const cached = entries.get(target); if (cached) return cached;
  const { sheet, horizontal } = sharedXYAxis(target.chart.state.series[target.seriesId]);
  const { members, keys, lanes, axes, anchors } = xyAxisOwners([...selected], sheet, horizontal);
  for (const chart of shared.charts) for (const field of chart.fields) {
    if (!references.has(field.key)) continue;
    if (!members.some(owner => owner.chart === chart && field.path[1] === owner.seriesId && field.path[2] === 'points')) {
      throw new Error('共享 XY 记录与类别或名称区域重叠，不能无歧义增删');
    }
  }
  const identities = new Set(shared.charts.flatMap(chart => [...Object.keys(chart.state.categories), ...Object.keys(chart.state.series),
    ...Object.values(chart.state.series).flatMap(series => Object.keys(series.points))]));
  const family: SharedXYFamily = { key: [...references].sort()[0], sheet, horizontal, keys, references, lanes,
    start: Math.min(...members.map(owner => owner.start)), end: Math.max(...members.map(owner => owner.end)),
    owners: members, identities, positions: axes, anchors };
  for (const owner of selected) entries.set(owner, family);
  return family;
}

export function sharedXYFamilyByKey(shared: SharedGroup, key: string): SharedXYFamily {
  const owner = xyOwners(shared).find(owner => owner.references.has(key));
  if (!owner) throw new Error('共享 XY 记录不属于此工作簿');
  const family = sharedXYFamily(shared, owner.chart.id, owner.seriesId);
  if (family.key !== key) throw new Error('共享 XY 记录轴身份无效');
  return family;
}

export const sharedXYCell = (family: SharedRecordAxis, lane: number, axis: number) => workbookCellKey(family.sheet,
  `${columnName(family.horizontal ? axis : lane)}${family.horizontal ? lane : axis}`);

export const xyOwnersForState = (family: SharedXYFamily, state: ChartDatasetState) => family.owners.filter(owner =>
  owner.chart.state.binding.chartPart === state.binding.chartPart && owner.seriesId in state.series);
