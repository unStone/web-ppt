import type { SharedGroup } from './shared-graph';
import type { SharedRecordAxis } from './shared-record-axis';
import type { InsertedResource } from './shared-inserted-project';
import type { XYResource } from './shared-xy-records';
import { sharedFamilyByKey } from './shared-family';
import { insertedRowLayout } from './shared-inserted-layout';
import { sharedXYFamilyByKey } from './shared-xy-family';
import { xyRecordLayout } from './shared-xy-records';

/** 来源区域彼此独立，不代表扩展后仍独立；空格也不能同时分配给两条记录轴。 */
export function assertSharedGrowthSpace(shared: SharedGroup, resource: InsertedResource & XYResource): void {
  const spaces: SharedRecordAxis[] = [];
  const add = (family: SharedRecordAxis, layout: { active: readonly unknown[]; deleted: readonly unknown[]; end: number }) => {
    if (layout.active.length || layout.deleted.length) spaces.push({ ...family, end: Math.max(family.end, layout.end) });
  };
  for (const key of Object.keys(resource.insertions ?? {})) {
    const family = sharedFamilyByKey(shared, key);
    add(family, insertedRowLayout(family, resource.insertions, resource.rows));
  }
  for (const [key, record] of Object.entries(resource.xyRecords ?? {})) {
    const family = sharedXYFamilyByKey(shared, key);
    add(family, xyRecordLayout(family, record));
  }
  spaces.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  for (let index = 0; index < spaces.length; index++) for (let peer = 0; peer < index; peer++) {
    const a = spaces[index], b = spaces[peer];
    if (a.sheet !== b.sheet) continue;
    const overlaps = a.horizontal === b.horizontal
      ? a.start <= b.end && b.start <= a.end && [...a.lanes].some(lane => b.lanes.has(lane))
      : [...a.lanes].some(lane => lane >= b.start && lane <= b.end) && [...b.lanes].some(lane => lane >= a.start && lane <= a.end);
    if (overlaps) throw new Error(`共享记录扩展区域 ${decodeURIComponent(a.key)} 与 ${decodeURIComponent(b.key)} 重叠`);
  }
}
