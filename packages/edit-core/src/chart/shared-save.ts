import type { EditDoc } from '../types';
import { chartSourceBytes } from './context';
import { sharedCellValue } from './shared-cell';
import { writeWorkbookCells } from './workbook-write';
import { removedCell, sharedCellAddress, shiftedCell } from './shared-rows';
import { columnName } from './formula';
import { workbookCellKey } from './workbook-read';
import { unusedSharedCells } from './shared-series';
import type { SharedSeriesRemovals } from './shared-series';
import { sharedWorkbookSource } from './shared-workbook-source';
import type { AddedSeries } from './shared-added-records';
import { planAddedSeries } from './shared-added-plan';
import { sharedGroupForWorkbook } from './shared-graph';
import { sharedCellFields } from './shared-fields';
import type { InsertedRows } from './shared-inserted-records';
import { writeInsertedCategories } from './shared-inserted-save';
import { insertedCellOverrides } from './shared-inserted-cells';
import { writeSharedXY } from './shared-xy-save';
import type { SharedXYRecords } from './shared-xy-records';

/** 共享保存直接消费唯一单元格覆盖；不能让不同图表的显示缓存轮流重写同一工作簿。 */
export function sharedWorkbookPatch(doc: EditDoc, workbook: string): Uint8Array | undefined {
  const resource = (doc.extensions?.['chart-shared'] as Record<string, {
    cells?: Record<string, unknown>; rows?: Record<string, unknown>; series?: SharedSeriesRemovals;
    addedSeries?: AddedSeries;
    insertions?: InsertedRows;
    xyRecords?: SharedXYRecords;
  }> | undefined)?.[workbook];
  if (!resource) return undefined;
  const source = chartSourceBytes(doc, workbook);
  if (!source) throw new Error(`共享工作簿不存在：${workbook}`);
  const { parts, map, baseline } = sharedWorkbookSource(doc, workbook);
  const shared = sharedGroupForWorkbook(doc, workbook);
  const values = shared ? insertedCellOverrides(shared, resource) : resource.cells ?? {};
  const writes = new Map<string, Map<string, { kind: 'number' | 'string'; value: string | number | null }>>();
  const write = (key: string, value: string | number | null) => {
    const separator = key.lastIndexOf('!'), sheet = decodeURIComponent(key.slice(0, separator));
    const cells = writes.get(sheet) ?? new Map();
    cells.set(key.slice(separator + 1), { kind: typeof value === 'number' ? 'number' : 'string', value });
    writes.set(sheet, cells);
  };
  const affected = new Set<string>();
  const unused = resource.series ? unusedSharedCells(doc, workbook) : new Set<string>();
  for (const key of unused) write(key, null);
  for (const [key, raw] of Object.entries(resource.rows ?? {})) {
    const cell = sharedCellAddress(key), { horizontal, end } = removedCell(raw);
    for (let axis = horizontal ? cell.column : cell.row; axis <= end; axis++) {
      const address = workbookCellKey(cell.sheet, `${columnName(horizontal ? axis : cell.column)}${horizontal ? cell.row : axis}`);
      affected.add(address); write(address, null);
    }
  }
  for (const key of new Set([...affected, ...Object.keys(resource.cells ?? {})])) {
    if (unused.has(key) || Object.prototype.hasOwnProperty.call(resource.rows ?? {}, key)) continue;
    const target = shiftedCell(key, resource.rows ?? {});
    write(target, sharedCellValue(key, values, baseline));
  }
  if (resource.insertions) {
    const shared = sharedGroupForWorkbook(doc, workbook);
    if (!shared) throw new Error('共享新增类别没有工作簿依赖图');
    writeInsertedCategories(doc, shared, resource, baseline, write);
  }
  if (resource.xyRecords) {
    if (!shared) throw new Error('共享 XY 记录没有工作簿依赖图');
    writeSharedXY(doc, shared, resource, baseline, write);
  }
  if (resource.addedSeries) {
    const shared = sharedGroupForWorkbook(doc, workbook);
    if (!shared) throw new Error('共享新增系列没有工作簿依赖图');
    for (const plan of planAddedSeries(shared, resource, baseline)) {
      if (plan.state.series[plan.id].removed) continue;
      for (const field of sharedCellFields(plan.state)) {
        if (field.path[0] === 'series' && field.path[1] === plan.id) write(field.key, field.value);
      }
    }
  }
  return writeWorkbookCells(source, parts, map, writes);
}
