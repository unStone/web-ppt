import type { SharedCategoryFamily } from './shared-family';
import type { InsertedRows } from './shared-inserted-records';
import { insertedRows } from './shared-inserted-records';
import { sharedCellAddress } from './shared-rows';
import type { RemovedCells } from './shared-rows';
import type { WorkbookCellValue } from './workbook-read';
import { workbookCellKey } from './workbook-read';
import { columnName } from './formula';
import type { SharedGroup } from './shared-graph';
import { MAX_CHART_CELLS } from './limits';
import { recordAxisLayout } from './shared-record-axis';
import type { SharedRecordAxis } from './shared-record-axis';
import { sharedFormulaCells } from './shared-fields';

export function insertedRowLayout(family: SharedCategoryFamily, insertions: InsertedRows | undefined, removals: RemovedCells = {}) {
  const records = insertedRows(family, insertions);
  const removed = new Map<number, Set<number>>();
  for (const key of Object.keys(removals)) {
    const cell = sharedCellAddress(key), axis = family.horizontal ? cell.column : cell.row, lane = family.horizontal ? cell.row : cell.column;
    if (cell.sheet !== family.sheet || !family.lanes.has(lane) || axis < family.start || axis > family.end) continue;
    const lanes = removed.get(axis) ?? new Set(); lanes.add(lane); removed.set(axis, lanes);
  }
  if ([...removed.values()].some(lanes => lanes.size !== family.lanes.size)) throw new Error('共享记录轴的删除字段尚未完整');
  const key = (lane: number, axis: number) => workbookCellKey(family.sheet,
    `${columnName(family.horizontal ? axis : lane)}${family.horizontal ? lane : axis}`);
  return { ...recordAxisLayout(family, records, new Set(removed.keys())), key };
}

export function assertInsertedRoom(shared: SharedGroup, family: SharedRecordAxis,
  layout: Pick<ReturnType<typeof insertedRowLayout>, 'active' | 'deleted' | 'end' | 'key'>, baseline: ReadonlyMap<string, WorkbookCellValue>): void {
  if (!layout.active.length && !layout.deleted.length) return;
  const end = Math.max(family.end, layout.end);
  if ((end - family.start + 1) * family.lanes.size > MAX_CHART_CELLS) throw new Error('共享记录扩展区域超过安全上限');
  if (end > (family.horizontal ? 16_384 : 1_048_576)) throw new Error('共享记录扩展超出工作表边界');
  const own = family.references ?? family.keys;
  const other = new Set(shared.charts.flatMap(chart => sharedFormulaCells(chart.state)).filter(key => !own.has(key)));
  for (const lane of family.lanes) for (let axis = family.start; axis <= end; axis++) {
    const key = layout.key(lane, axis), cell = baseline.get(key);
    if (other.has(key) || !family.keys.has(key) && cell && (cell.kind === 'unsupported' || cell.value !== null)) {
      throw new Error(`共享记录扩展区域 ${decodeURIComponent(key)} 被其他内容占用`);
    }
  }
}
