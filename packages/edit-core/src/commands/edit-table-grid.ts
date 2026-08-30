import { fractionalIndexBetween } from '../fractional-index';
import { logicalIdentityPrefix } from '../identity-allocation';
import { normalizeVectorFill } from '../shape-fill';
import { normalizeStroke } from '../shape-stroke';
import {
  tableCellAddressFromStableRef, tableCellOverrideKeyFromRefs,
} from '../table-cell';
import {
  effectiveTableMerges, orderedTableColumns, orderedTableRows, queryTableGrid,
  tableCellMergeRole, tableColumnById,
} from '../table-grid';
import type {
  EditDoc, ElementRecord, TableCellRef, TableMergeRegion,
} from '../types';
import type {
  CommandPatches, InsertColumnCommand, MergeCellsCommand, RemoveColumnCommand,
  RemoveRowCommand, SetCellPropsCommand, SetColumnWidthCommand, SetRowHeightCommand,
  SplitCellCommand, TableCellPropsPatch, TableColumnPatch, TableGridEntryPatch,
  TableMergePatch,
} from './types';

function editableTable(doc: EditDoc, id: string): ElementRecord & { readonly src: TableElement } {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能执行命令');
  const record = doc.elements[id];
  if (!record || record.src.kind !== 'table') throw new Error(`找不到可编辑表格：${id}`);
  if (record.meta.editable !== 'full' || record.meta.locked) throw new Error(`表格不可编辑：${id}`);
  return record as ElementRecord & { readonly src: TableElement };
}

function allocateColumnId(doc: EditDoc, record: ElementRecord, origin: string): string {
  for (;;) {
    const serial = (doc.identity.nextElement++).toString(36);
    const id = `${logicalIdentityPrefix(doc.identity)}c${serial}:${origin.length.toString(36)}:${origin}`;
    if (!record.ovr.tableColumns?.[id]) return id;
  }
}

function assertBefore(value: unknown, label: string): { readonly before: string | null } | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Reflect.ownKeys(value).length !== 1
    || !Object.prototype.hasOwnProperty.call(value, 'before')) throw new Error(`${label} 无效`);
  const before = (value as { before?: unknown }).before;
  if (before !== null && (typeof before !== 'string' || !before)) throw new Error(`${label}.before 无效`);
  return { before } as { readonly before: string | null };
}

export function insertColumnPatches(
  doc: EditDoc, command: InsertColumnCommand, origin: string,
): CommandPatches {
  const record = editableTable(doc, command.id);
  if (!record.src.rows.length || !record.src.colWidths.length) throw new Error(`表格没有可复制的行列：${command.id}`);
  const at = assertBefore(command.at, 'InsertColumn.at');
  const columns = orderedTableColumns(record);
  const before = at?.before === null || at === undefined ? null : tableColumnById(record, at.before);
  if (at?.before && !before) throw new Error(`找不到插入位置列：${at.before}`);
  const nextIndex = before ? columns.findIndex((column) => column.id === before.id) : columns.length;
  const previous = columns[nextIndex - 1] ?? null;
  const next = columns[nextIndex] ?? null;
  const columnId = allocateColumnId(doc, record, origin);
  const value = {
    order: fractionalIndexBetween(previous?.order ?? null, next?.order ?? null, columnId),
    template: next?.source ?? previous?.source ?? record.src.colWidths.length - 1,
  };
  const path = ['elements', record.id, 'ovr', 'tableColumns', columnId] as const;
  return {
    forward: [{ op: 'insert', path, value, origin } satisfies TableColumnPatch],
    inverse: [{ op: 'remove', path, value, origin } satisfies TableColumnPatch],
  };
}

function removedPatch(
  record: ElementRecord, field: 'tableRemovedRows' | 'tableRemovedColumns', id: string,
  origin: string,
): CommandPatches {
  const current = record.ovr[field]?.[id];
  if (current) throw new Error(`表格网格身份已经删除：${id}`);
  const path = ['elements', record.id, 'ovr', field, id] as const;
  return {
    forward: [{ op: 'set', path, value: true, origin } satisfies TableGridEntryPatch],
    inverse: [{ op: 'del', path, origin } satisfies TableGridEntryPatch],
  };
}

export function removeRowPatches(
  doc: EditDoc, command: RemoveRowCommand, origin: string,
): CommandPatches {
  const record = editableTable(doc, command.id);
  const rows = orderedTableRows(record);
  if (rows.length <= 1) throw new Error('表格至少保留一行');
  if (!rows.some((row) => row.id === command.row)) throw new Error(`找不到表格行：${command.row}`);
  // tombstone 只改变可见投影；撤销后同一稳定身份的内容、尺寸与合并拓扑必须自然恢复。
  return removedPatch(record, 'tableRemovedRows', command.row, origin);
}

export function removeColumnPatches(
  doc: EditDoc, command: RemoveColumnCommand, origin: string,
): CommandPatches {
  const record = editableTable(doc, command.id);
  const columns = orderedTableColumns(record);
  if (columns.length <= 1) throw new Error('表格至少保留一列');
  if (!columns.some((column) => column.id === command.column)) {
    throw new Error(`找不到表格列：${command.column}`);
  }
  return removedPatch(record, 'tableRemovedColumns', command.column, origin);
}

function sizePatches(
  record: ElementRecord, field: 'tableRowHeights' | 'tableColumnWidths', id: string,
  value: number, origin: string,
): CommandPatches {
  if (!Number.isFinite(value) || value <= 0) throw new Error('表格网格尺寸必须是正数');
  const before = record.ovr[field]?.[id];
  if (before === value) return { forward: [], inverse: [] };
  const path = ['elements', record.id, 'ovr', field, id] as const;
  return {
    forward: [{ op: 'set', path, value, origin } satisfies TableGridEntryPatch],
    inverse: [before === undefined
      ? { op: 'del', path, origin } satisfies TableGridEntryPatch
      : { op: 'set', path, value: before, origin } satisfies TableGridEntryPatch],
  };
}

export function setRowHeightPatches(
  doc: EditDoc, command: SetRowHeightCommand, origin: string,
): CommandPatches {
  const record = editableTable(doc, command.id);
  if (!orderedTableRows(record).some((row) => row.id === command.row)) throw new Error(`找不到表格行：${command.row}`);
  return sizePatches(record, 'tableRowHeights', command.row, command.height, origin);
}

export function setColumnWidthPatches(
  doc: EditDoc, command: SetColumnWidthCommand, origin: string,
): CommandPatches {
  const record = editableTable(doc, command.id);
  if (!orderedTableColumns(record).some((column) => column.id === command.column)) {
    throw new Error(`找不到表格列：${command.column}`);
  }
  return sizePatches(record, 'tableColumnWidths', command.column, command.width, origin);
}

function rect(record: ElementRecord, from: TableCellRef, to: TableCellRef): readonly [number, number, number, number] {
  const first = tableCellAddressFromStableRef(record, from);
  const last = tableCellAddressFromStableRef(record, to);
  if (!first || !last) throw new Error('表格合并坐标包含不存在的行列身份');
  return [Math.min(first.r, last.r), Math.min(first.c, last.c),
    Math.max(first.r, last.r), Math.max(first.c, last.c)];
}

function completeGridRecord(record: ElementRecord): ElementRecord {
  return {
    ...record,
    ovr: { ...record.ovr, tableRemovedRows: undefined, tableRemovedColumns: undefined },
  };
}

function normalizedRegion(record: ElementRecord, from: TableCellRef, to: TableCellRef): TableMergeRegion {
  const [r1, c1, r2, c2] = rect(record, from, to);
  const grid = queryTableGrid({ elements: { [record.id]: record } } as EditDoc, record.id);
  return {
    from: { row: grid.rows[r1].id, column: grid.columns[c1].id },
    to: { row: grid.rows[r2].id, column: grid.columns[c2].id },
  };
}

function mergePatch(
  record: ElementRecord, value: readonly TableMergeRegion[], origin: string,
): CommandPatches {
  const path = ['elements', record.id, 'ovr', 'tableMerges'] as const;
  const before = record.ovr.tableMerges;
  return {
    forward: [{ op: 'set', path, value, origin } satisfies TableMergePatch],
    inverse: [before === undefined
      ? { op: 'del', path, origin } satisfies TableMergePatch
      : { op: 'set', path, value: before, origin } satisfies TableMergePatch],
  };
}

function intersects(a: readonly number[], b: readonly number[]): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

export function mergeCellsPatches(
  doc: EditDoc, command: MergeCellsCommand, origin: string,
): CommandPatches {
  const record = editableTable(doc, command.id);
  const region = normalizedRegion(record, command.from, command.to);
  const target = rect(record, region.from, region.to);
  if (target[0] === target[2] && target[1] === target[3]) throw new Error('至少选择两个单元格才能合并');
  const visible = queryTableGrid(doc, record.id).merges;
  if (visible.some((merge) => intersects(target, rect(record, merge.from, merge.to)))) {
    throw new Error('新合并区域不能与现有合并重叠');
  }
  const complete = completeGridRecord(record);
  const completeTarget = rect(complete, region.from, region.to);
  // 新矩形跨过隐藏身份时会显式取代与之相交的休眠合并；无关休眠区域必须保留。
  const current = effectiveTableMerges(record).filter((merge) =>
    !intersects(completeTarget, rect(complete, merge.from, merge.to)));
  return mergePatch(record, [...current, region], origin);
}

export function splitCellPatches(
  doc: EditDoc, command: SplitCellCommand, origin: string,
): CommandPatches {
  const record = editableTable(doc, command.id);
  const point = tableCellAddressFromStableRef(record, command.cell);
  if (!point) throw new Error('拆分坐标包含不存在的行列身份');
  const visible = queryTableGrid(doc, record.id).merges;
  const visibleMerge = visible.find((merge) => {
    const [r1, c1, r2, c2] = rect(record, merge.from, merge.to);
    return point.r >= r1 && point.r <= r2 && point.c >= c1 && point.c <= c2;
  });
  if (!visibleMerge) throw new Error('指定单元格不属于合并区域');
  const complete = completeGridRecord(record);
  const completePoint = tableCellAddressFromStableRef(complete, command.cell)!;
  const current = effectiveTableMerges(record);
  const index = current.findIndex((merge) => {
    const [r1, c1, r2, c2] = rect(complete, merge.from, merge.to);
    return completePoint.r >= r1 && completePoint.r <= r2
      && completePoint.c >= c1 && completePoint.c <= c2;
  });
  if (index < 0) throw new Error('可见合并缺少完整合并真值');
  return mergePatch(record, current.filter((_, mergeIndex) => mergeIndex !== index), origin);
}

export function setCellPropsPatches(
  doc: EditDoc, command: SetCellPropsCommand, origin: string,
): CommandPatches {
  const record = editableTable(doc, command.id);
  const address = tableCellAddressFromStableRef(record, command.cell);
  if (!address) throw new Error('单元格格式坐标包含不存在的行列身份');
  if (tableCellMergeRole(record, command.cell) === 'placeholder') {
    throw new Error('合并占位格不可单独设置格式');
  }
  const rows = orderedTableRows(record);
  const columns = orderedTableColumns(record);
  const key = tableCellOverrideKeyFromRefs(rows[address.r].rowRef, columns[address.c].columnRef);
  if (!command.props || typeof command.props !== 'object' || !Reflect.ownKeys(command.props).length) {
    throw new Error('SetCellProps.props 至少包含一个字段');
  }
  const allowed = new Set(['fill', 'borders', 'margins', 'vAlign', 'vert']);
  if (Reflect.ownKeys(command.props).some((field) => !allowed.has(String(field)))) {
    throw new Error('SetCellProps.props 包含未知字段');
  }
  const before = record.ovr.tableCells?.[key];
  const forward: TableCellPropsPatch[] = [];
  const inverse: TableCellPropsPatch[] = [];
  for (const field of allowed) {
    if (!Object.prototype.hasOwnProperty.call(command.props, field)) continue;
    const input = command.props[field as keyof SetCellPropsCommand['props']];
    const value = input === null ? null
      : field === 'fill' && input ? normalizeVectorFill(input as Exclude<import('@web-ppt/core').Fill, { type: 'image' }>)
      : field === 'borders' && input ? Object.fromEntries(Object.entries(input).map(([side, stroke]) => [
        side, stroke === null ? null : normalizeStroke(stroke),
      ]))
      : field === 'margins' && input ? (input as [number, number, number, number])
        .map((part) => Math.round(part * 9525) / 9525) as [number, number, number, number]
      : input;
    const path = ['elements', record.id, 'ovr', 'tableCells', key, field] as TableCellPropsPatch['path'];
    forward.push(value === null
      ? { op: 'del', path, origin }
      : { op: 'set', path, value, origin });
    const previous = (before as Record<string, unknown> | undefined)?.[field] as TableCellPropsPatch['value'];
    inverse.unshift(previous === undefined
      ? { op: 'del', path, origin }
      : { op: 'set', path, value: previous, origin });
  }
  return { forward, inverse };
}
import type { TableElement } from '@web-ppt/core';
