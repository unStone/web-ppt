import { assertDataObject } from '../data-validation';
import { assertFractionalIndex, initialFractionalIndex } from '../fractional-index';
import { tableCellKeyResolver } from '../table-cell';
import { orderedTableColumns, orderedTableRows, queryTableGrid } from '../table-grid';
import type { EditDoc, ElementRecord, TableCellOverrides } from '../types';
import type {
  Patch, TableCellPropsPatch, TableColumnPatch, TableGridEntryPatch, TableMergePatch,
} from './types';

const ENTRY_FIELDS = new Set([
  'tableRemovedRows', 'tableRemovedColumns', 'tableRowHeights', 'tableColumnWidths',
]);
const CELL_FIELDS = new Set(['fill', 'borders', 'margins', 'vAlign', 'vert']);

function tableRecord(
  doc: EditDoc, id: string, index: number,
): ElementRecord & { readonly src: TableElement } {
  const record = doc.elements[id];
  if (!record || record.src.kind !== 'table' || record.meta.editable !== 'full') {
    throw new Error(`Patch ${index} 没有指向可编辑表格`);
  }
  return record as ElementRecord & { readonly src: TableElement };
}

export function isTableColumnPatch(patch: Patch): patch is TableColumnPatch {
  return patch.path.length === 5 && patch.path[0] === 'elements' && patch.path[2] === 'ovr'
    && patch.path[3] === 'tableColumns' && (patch.op === 'insert' || patch.op === 'remove');
}

export function isTableGridEntryPatch(patch: Patch): patch is TableGridEntryPatch {
  return patch.path.length === 5 && patch.path[0] === 'elements' && patch.path[2] === 'ovr'
    && ENTRY_FIELDS.has(String(patch.path[3])) && (patch.op === 'set' || patch.op === 'del');
}

export function isTableMergePatch(patch: Patch): patch is TableMergePatch {
  return patch.path.length === 4 && patch.path[0] === 'elements' && patch.path[2] === 'ovr'
    && patch.path[3] === 'tableMerges' && (patch.op === 'set' || patch.op === 'del');
}

export function isTableCellPropsPatch(patch: Patch): patch is TableCellPropsPatch {
  return patch.path.length === 6 && patch.path[0] === 'elements' && patch.path[2] === 'ovr'
    && patch.path[3] === 'tableCells' && typeof patch.path[4] === 'string'
    && CELL_FIELDS.has(String(patch.path[5])) && (patch.op === 'set' || patch.op === 'del');
}

export function validateTableColumnPatch(doc: EditDoc, patch: TableColumnPatch, index: number): void {
  const record = tableRecord(doc, patch.path[1], index);
  const id = patch.path[4];
  if (!id) throw new Error(`Patch ${index} 的列身份无效`);
  assertDataObject(patch.value, ['order', 'template'], `Patch ${index} 的新增列`);
  assertFractionalIndex(patch.value.order);
  if (patch.value.template !== undefined
    && (!Number.isSafeInteger(patch.value.template) || patch.value.template < 0
      || patch.value.template >= record.src.colWidths.length)) {
    throw new Error(`Patch ${index} 的列模板无效`);
  }
  const current = record.ovr.tableColumns?.[id];
  if (patch.op === 'insert' && current) throw new Error(`Patch ${index} 的列身份已经存在：${id}`);
  if (patch.op === 'remove' && (!current || current.order !== patch.value.order)) {
    throw new Error(`Patch ${index} 要移除的列状态不存在：${id}`);
  }
  if (record.src.colWidths.some((_, source) => patch.value.order === initialFractionalIndex(source))) {
    throw new Error(`Patch ${index} 的列顺序与来源列冲突`);
  }
  if (Object.entries(record.ovr.tableColumns ?? {})
    .some(([other, value]) => other !== id && value.order === patch.value.order)) {
    throw new Error(`Patch ${index} 的列顺序重复`);
  }
}

export function validateTableGridEntryPatch(
  doc: EditDoc, patch: TableGridEntryPatch, index: number,
): void {
  const record = tableRecord(doc, patch.path[1], index);
  const field = patch.path[3];
  const id = patch.path[4];
  const rows = field === 'tableRemovedRows' || field === 'tableRowHeights';
  const exists = rows
    ? orderedTableRows({ ...record, ovr: { ...record.ovr, tableRemovedRows: undefined } }).some((row) => row.id === id)
    : orderedTableColumns({ ...record, ovr: { ...record.ovr, tableRemovedColumns: undefined } }).some((column) => column.id === id);
  if (!exists) throw new Error(`Patch ${index} 的表格${rows ? '行' : '列'}身份无效：${id}`);
  if (patch.op === 'set') {
    if (field === 'tableRemovedRows' || field === 'tableRemovedColumns') {
      if (patch.value !== true) throw new Error(`Patch ${index} 的删除标记无效`);
    } else if (typeof patch.value !== 'number' || !Number.isFinite(patch.value) || patch.value <= 0) {
      throw new Error(`Patch ${index} 的网格尺寸必须为正数`);
    }
  }
}

function rectangle(
  rows: readonly { id: string }[], columns: readonly { id: string }[],
  region: { from: { row: string; column: string }; to: { row: string; column: string } },
): readonly [number, number, number, number] {
  const r1 = rows.findIndex((row) => row.id === region.from.row);
  const r2 = rows.findIndex((row) => row.id === region.to.row);
  const c1 = columns.findIndex((column) => column.id === region.from.column);
  const c2 = columns.findIndex((column) => column.id === region.to.column);
  if ([r1, r2, c1, c2].some((value) => value < 0)) throw new Error('合并区域包含不存在的行列身份');
  return [Math.min(r1, r2), Math.min(c1, c2), Math.max(r1, r2), Math.max(c1, c2)];
}

export function assertTableMergeRegions(record: ElementRecord, value: unknown, label: string): void {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  const grid = queryTableGrid({ elements: { [record.id]: record } } as EditDoc, record.id);
  const occupied = new Set<string>();
  value.forEach((region, index) => {
    assertDataObject(region, ['from', 'to'], `${label}[${index}]`);
    const candidate = region as { from: unknown; to: unknown };
    assertDataObject(candidate.from, ['row', 'column'], `${label}[${index}].from`);
    assertDataObject(candidate.to, ['row', 'column'], `${label}[${index}].to`);
    const typed = candidate as { from: { row: unknown; column: unknown }; to: { row: unknown; column: unknown } };
    for (const ref of [typed.from, typed.to]) {
      if (typeof ref.row !== 'string' || !ref.row || typeof ref.column !== 'string' || !ref.column) {
        throw new Error(`${label}[${index}] 的行列身份无效`);
      }
    }
    const [r1, c1, r2, c2] = rectangle(grid.rows, grid.columns, typed as {
      from: { row: string; column: string }; to: { row: string; column: string };
    });
    if (r1 === r2 && c1 === c2) throw new Error(`${label}[${index}] 不能是单格合并`);
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
      const key = `${r}:${c}`;
      if (occupied.has(key)) throw new Error(`${label}[${index}] 与其他合并区域重叠`);
      occupied.add(key);
    }
  });
}

export function validateTableMergePatch(doc: EditDoc, patch: TableMergePatch, index: number): void {
  const record = tableRecord(doc, patch.path[1], index);
  if (patch.op === 'set') assertTableMergeRegions(record, patch.value, `Patch ${index} 的合并区域`);
}

export function validateTableCellPropsPatch(
  doc: EditDoc, patch: TableCellPropsPatch, index: number,
): void {
  const record = tableRecord(doc, patch.path[1], index);
  if (!tableCellKeyResolver(record)(patch.path[4])) throw new Error(`Patch ${index} 的单元格身份无效`);
  if (patch.op === 'del') return;
  const field = patch.path[5];
  if (field === 'margins') {
    if (!Array.isArray(patch.value) || patch.value.length !== 4
      || patch.value.some((part) => typeof part !== 'number' || !Number.isFinite(part) || part < 0)) {
      throw new Error(`Patch ${index} 的单元格边距无效`);
    }
  } else if (field === 'vAlign' && !['top', 'middle', 'bottom'].includes(String(patch.value))) {
    throw new Error(`Patch ${index} 的单元格垂直对齐无效`);
  } else if (field === 'vert' && typeof patch.value !== 'string') {
    throw new Error(`Patch ${index} 的单元格文字方向无效`);
  } else if ((field === 'fill' || field === 'borders') && (!patch.value || typeof patch.value !== 'object')) {
    throw new Error(`Patch ${index} 的单元格直接格式无效`);
  }
}

export function applyTableGridPatch(
  doc: EditDoc,
  patch: TableColumnPatch | TableGridEntryPatch | TableMergePatch | TableCellPropsPatch,
): void {
  const record = doc.elements[patch.path[1]]!;
  if (isTableColumnPatch(patch)) {
    if (patch.op === 'insert') {
      const columns = record.ovr.tableColumns ?? (record.ovr.tableColumns = Object.create(null));
      columns[patch.path[4]] = { ...patch.value };
    } else {
      delete record.ovr.tableColumns?.[patch.path[4]];
      if (record.ovr.tableColumns && !Reflect.ownKeys(record.ovr.tableColumns).length) delete record.ovr.tableColumns;
    }
    return;
  }
  if (isTableGridEntryPatch(patch)) {
    const field = patch.path[3];
    if (patch.op === 'set') {
      const map = record.ovr[field] ?? (record.ovr[field] = Object.create(null));
      (map as Record<string, true | number>)[patch.path[4]] = patch.value!;
    } else {
      delete (record.ovr[field] as Record<string, unknown> | undefined)?.[patch.path[4]];
      if (record.ovr[field] && !Reflect.ownKeys(record.ovr[field]!).length) delete record.ovr[field];
    }
    return;
  }
  if (isTableMergePatch(patch)) {
    if (patch.op === 'set') record.ovr.tableMerges = structuredClone(patch.value);
    else delete record.ovr.tableMerges;
    return;
  }
  const cells = record.ovr.tableCells ?? (record.ovr.tableCells = Object.create(null));
  const cell = cells[patch.path[4]] ?? (cells[patch.path[4]] = {});
  const field = patch.path[5] as keyof Omit<TableCellOverrides, 'text'>;
  if (patch.op === 'set') (cell as Record<string, unknown>)[field] = structuredClone(patch.value);
  else delete cell[field];
  if (!Reflect.ownKeys(cell).length) delete cells[patch.path[4]];
  if (!Reflect.ownKeys(cells).length) delete record.ovr.tableCells;
}
import type { TableElement } from '@web-ppt/core';
