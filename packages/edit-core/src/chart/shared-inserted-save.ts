import type { EditDoc } from '../types';
import type { SharedGroup } from './shared-graph';
import type { InsertedResource } from './shared-inserted-project';
import { sharedFamilyByKey } from './shared-family';
import { insertedRowLayout, assertInsertedRoom } from './shared-inserted-layout';
import type { WorkbookCellValue } from './workbook-read';
import { projectSharedDataset } from './shared';
import { sharedCategoryFields, sharedCellFields } from './shared-fields';
import { sharedCellAddress } from './shared-rows';

/** 全轴一次压紧或插入；所有视图回写同一组单元格，不能各自重排自己的子范围。 */
export function writeInsertedCategories(doc: EditDoc, shared: SharedGroup, resource: InsertedResource,
  baseline: ReadonlyMap<string, WorkbookCellValue>, write: (key: string, value: string | number | null) => void): void {
  for (const key of Object.keys(resource.insertions ?? {})) {
    const family = sharedFamilyByKey(shared, key), layout = insertedRowLayout(family, resource.insertions, resource.rows);
    assertInsertedRoom(shared, family, layout, baseline);
    if (!layout.active.length) continue;
    const charts = new Set([...family.charts, ...family.xyOwners.map(owner => owner.chart)]);
    const numbers = family.numericLanes;
    for (const lane of family.lanes) for (let axis = family.start; axis <= Math.max(family.end, layout.end); axis++) write(layout.key(lane, axis), null);
    for (const chart of charts) {
      const state = projectSharedDataset(doc, shared, structuredClone(chart.state));
      if (state.binding.mode === 'readonly') throw new Error(state.binding.reason ?? '共享类别数据不可保存');
      const xy = new Set<string>(family.xyOwners.filter(owner => owner.chart === chart).map(owner => owner.seriesId));
      const fields = [...sharedCategoryFields(state), ...sharedCellFields(state).filter(field => field.path[2] === 'points' && xy.has(field.path[1]))];
      for (const field of fields) {
        if (field.path[0] !== 'categories' && !(field.path[2] === 'points' && field.path[1] in chart.state.series)) continue;
        const cell = sharedCellAddress(field.key), lane = family.horizontal ? cell.row : cell.column;
        const value = numbers.has(lane) && field.value !== null ? Number(field.value) : field.value;
        write(field.key, value);
      }
    }
  }
}
