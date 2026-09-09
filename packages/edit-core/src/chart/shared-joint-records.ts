import type { SharedGroup } from './shared-graph';
import type { SharedCategoryFamily } from './shared-family';
import { sharedCategoryFamily, sharedCategoryForXY, sharedFamilyByKey } from './shared-family';
import type { InsertedResource } from './shared-inserted-project';
import { insertedRowLayout } from './shared-inserted-layout';
import type { SharedXYFamily } from './shared-xy-family';
import type { XYAxisRecords } from './shared-xy-records';

/** XY 视图借用共同记录的布局；派生适配不向文档写入第二份结构状态。 */
export function jointXYRecords(shared: SharedGroup, resource: InsertedResource): Array<{ family: SharedXYFamily; record: XYAxisRecords }> {
  const families = new Map<string, SharedCategoryFamily>();
  const add = (family: SharedCategoryFamily | undefined) => {
    if (family?.xyOwners.length) families.set(family.key, family);
  };
  for (const key of Object.keys(resource.insertions ?? {})) add(sharedFamilyByKey(shared, key));
  if (resource.rows) for (const chart of shared.charts) {
    const affected = chart.fields.filter(field => Object.prototype.hasOwnProperty.call(resource.rows, field.key));
    if (affected.some(field => field.path[0] === 'categories')) add(sharedCategoryFamily(shared, chart.id));
    for (const field of affected) if (field.path[0] === 'series' && field.path[2] === 'points') {
      const series = chart.state.series[field.path[1] as keyof typeof chart.state.series];
      if (series.plotKind === 'scatter' || series.plotKind === 'bubble') add(sharedCategoryForXY(shared, chart.id, series.id));
    }
  }
  return [...families.values()].map(category => {
    const layout = insertedRowLayout(category, resource.insertions, resource.rows);
    return { family: { ...category, owners: category.xyOwners,
      identities: new Set<string>(), positions: new Set(category.xyOwners.flatMap(owner => [...owner.positions.values()])),
      anchors: new Set(category.xyOwners.flatMap(owner => [...owner.positions.values()])) },
    record: { insertions: resource.insertions?.[category.key], removed: Object.fromEntries(layout.deleted.map(axis => [String(axis), true])) } };
  });
}
