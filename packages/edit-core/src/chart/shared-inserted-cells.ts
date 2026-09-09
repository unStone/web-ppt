import type { SharedGroup } from './shared-graph';
import type { InsertedRows } from './shared-inserted-records';
import { insertedRows } from './shared-inserted-records';
import { sharedFamilyByKey, sharedCategoryFamily } from './shared-family';
import { sharedCellAddress } from './shared-rows';
import { workbookCellKey } from './workbook-read';
import { columnName } from './formula';
import { assertChartIdentity } from './validation';
import { decodeSharedCell } from './shared-cell';

export interface InsertedCellResource {
  readonly insertions?: InsertedRows;
  readonly cells?: Readonly<Record<string, unknown>>;
}
export const insertedCellKey = (id: string, lane: number | string): string => `@row:${id}:${lane}`;

export function insertedCellReference(key: string): { id: string; lane: number } | undefined {
  if (!key.startsWith('@row:')) return;
  const separator = key.lastIndexOf(':'), id = key.slice(5, separator), raw = key.slice(separator + 1), lane = Number(raw);
  assertChartIdentity(id, id, '共享新增单元格身份');
  if (!Number.isInteger(lane) || lane < 1 || String(lane) !== raw) throw new Error('共享新增单元格列无效');
  return { id, lane };
}

export function validateInsertedCellReference(shared: SharedGroup, target: string, parent: string,
  insertions?: InsertedRows): void {
  const ref = insertedCellReference(parent);
  if (!ref) return;
  const owner = shared.charts.find(chart => chart.fields.some(field => field.key === target && field.parent));
  if (!owner) throw new Error('新增类别父引用只能用于来源父级单元格');
  const family = sharedCategoryFamily(shared, owner.id), cell = sharedCellAddress(target);
  if ((family.horizontal ? cell.row : cell.column) !== ref.lane) throw new Error('新增类别父引用必须属于同一层级列');
  if (insertions) {
    const row = insertedRows(family, insertions).find(row => row.id === ref.id);
    if (!row || row.anchor >= (family.horizontal ? cell.column : cell.row)) throw new Error('新增类别父引用必须指向前面的稳定记录');
  }
}

/** 虚拟单元格只是引用解析图的节点，所有字面值仍只有文档中的一份记录。 */
export function insertedCellOverrides(shared: SharedGroup, resource: InsertedCellResource): Record<string, unknown> {
  const result = { ...resource.cells };
  for (const [key, raw] of Object.entries(resource.cells ?? {})) {
    const value = decodeSharedCell(raw);
    if ('parent' in value && insertedCellReference(value.parent)) {
      validateInsertedCellReference(shared, key, value.parent, resource.insertions ?? {});
    }
  }
  for (const key of Object.keys(resource.insertions ?? {})) {
    const family = sharedFamilyByKey(shared, key), rows = insertedRows(family, resource.insertions);
    const parentLevels = new Map<number, Set<number>>();
    for (const chart of family.charts) for (const field of chart.fields) {
      if (!field.parent) continue;
      const cell = sharedCellAddress(field.key), lane = family.horizontal ? cell.row : cell.column;
      const levels = parentLevels.get(lane) ?? new Set(); levels.add(field.parent.level); parentLevels.set(lane, levels);
    }
    for (const row of rows) for (const lane of family.lanes) {
      const value = row.cells?.[String(lane)] ?? null;
      const parents = parentLevels.get(lane);
      const reset = [...parents ?? []].some(level => Array.from({ length: level }, (_, index) => lane - level + index)
        .some(higher => row.cells?.[String(higher)] !== undefined && row.cells[String(higher)] !== null));
      const source = workbookCellKey(family.sheet, `${columnName(family.horizontal ? row.anchor : lane)}${family.horizontal ? lane : row.anchor}`);
      result[insertedCellKey(row.id, lane)] = JSON.stringify(value === null && parents?.size && !reset
        ? { parent: row.parent ? insertedCellKey(row.parent, lane) : source } : { value });
    }
  }
  return result;
}
