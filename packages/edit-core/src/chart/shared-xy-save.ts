import type { EditDoc } from '../types';
import type { SharedGroup } from './shared-graph';
import type { XYResource } from './shared-xy-records';
import type { WorkbookCellValue } from './workbook-read';
import { xyRecordLayout } from './shared-xy-records';
import { sharedXYFamilyByKey } from './shared-xy-family';
import { assertInsertedRoom } from './shared-inserted-layout';
import { projectSharedDataset } from './shared';
import { sharedCellFields } from './shared-fields';

export function writeSharedXY(doc: EditDoc, shared: SharedGroup, resource: XYResource,
  baseline: ReadonlyMap<string, WorkbookCellValue>, write: (key: string, value: string | number | null) => void): void {
  for (const [key, record] of Object.entries(resource.xyRecords ?? {})) {
    const family = sharedXYFamilyByKey(shared, key), layout = xyRecordLayout(family, record);
    assertInsertedRoom(shared, family, layout, baseline);
    if (!layout.active.length && !layout.deleted.length) continue;
    for (const lane of family.lanes) for (let axis = family.start; axis <= Math.max(family.end, layout.end); axis++) write(layout.key(lane, axis), null);
    const charts = new Set(family.owners.map(owner => owner.chart));
    for (const chart of charts) {
      const state = projectSharedDataset(doc, shared, structuredClone(chart.state));
      if (state.binding.mode === 'readonly') throw new Error(state.binding.reason ?? '共享 XY 记录不可保存');
      const seriesIds = new Set<string>(family.owners.filter(owner => owner.chart === chart).map(owner => owner.seriesId));
      for (const field of sharedCellFields(state)) {
        if (field.path[2] === 'points' && seriesIds.has(field.path[1])) write(field.key, field.value);
      }
    }
  }
}
