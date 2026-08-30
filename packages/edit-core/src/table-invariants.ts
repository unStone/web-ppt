import { assertDataObject, own } from './data-validation';
import { assertFractionalIndex, initialFractionalIndex } from './fractional-index';
import { assertStroke } from './shape-stroke';
import { assertVectorFill } from './shape-fill';
import { tableCellKeyResolver, tableCellStableRefFromKey } from './table-cell';
import {
  isReservedTableColumnId, isReservedTableRowId, orderedTableColumns, orderedTableRows,
  sourceTableColumnId, sourceTableRowId, tableCellMergeRole,
} from './table-grid';
import type { EditDoc, ElementRecord } from './types';
import { assertTableMergeRegions } from './commands/table-grid-patch';
import { textTargetContext } from './commands/text-target';

export function assertTableRows(record: ElementRecord): void {
  const rows = record.ovr.tableRows;
  if (rows === undefined) return;
  if (record.src.kind !== 'table' || !record.src.rows.length) {
    throw new Error(`非表格元素 ${record.id} 不能包含追加行`);
  }
  assertDataObject(rows, Object.keys(rows), `表格 ${record.id} 的追加行`);
  const entries = Object.entries(rows);
  if (!entries.length) throw new Error(`表格 ${record.id} 的追加行不能为空`);
  const orders = new Set<string>();
  for (const [id, insertion] of entries) {
    if (!id) throw new Error(`表格 ${record.id} 的追加行身份不能为空`);
    if (isReservedTableRowId(id)) throw new Error(`表格 ${record.id} 的追加行占用了来源身份：${id}`);
    assertDataObject(insertion, ['order', 'template'], `表格 ${record.id} 的追加行 ${id}`);
    if (typeof insertion.order !== 'string') throw new Error(`表格 ${record.id} 的追加行顺序无效`);
    assertFractionalIndex(insertion.order);
    if (insertion.template !== undefined
      && (!Number.isSafeInteger(insertion.template) || insertion.template < 0
        || insertion.template >= record.src.rows.length)) {
      throw new Error(`表格 ${record.id} 的追加行模板无效`);
    }
    if (record.src.rows.some((_, source) => insertion.order === initialFractionalIndex(source))) {
      throw new Error(`表格 ${record.id} 的追加行顺序与来源行冲突`);
    }
    if (orders.has(insertion.order)) throw new Error(`表格 ${record.id} 的追加行顺序重复`);
    orders.add(insertion.order);
  }
}

export function assertTableGridOverrides(record: ElementRecord): void {
  if (record.src.kind !== 'table') {
    const fields = ['tableColumns', 'tableRemovedRows', 'tableRemovedColumns', 'tableRowHeights',
      'tableColumnWidths', 'tableMerges'] as const;
    if (fields.some((field) => own(record.ovr, field))) {
      throw new Error(`非表格元素 ${record.id} 不能包含网格覆盖`);
    }
    return;
  }
  const columns = record.ovr.tableColumns;
  if (columns) {
    assertDataObject(columns, Object.keys(columns), `表格 ${record.id} 的新增列`);
    if (!Object.keys(columns).length) throw new Error(`表格 ${record.id} 的新增列不能为空`);
    const orders = new Set<string>();
    for (const [id, insertion] of Object.entries(columns)) {
      if (!id) throw new Error(`表格 ${record.id} 的新增列身份不能为空`);
      if (isReservedTableColumnId(id)) throw new Error(`表格 ${record.id} 的新增列占用了来源身份：${id}`);
      assertDataObject(insertion, ['order', 'template'], `表格 ${record.id} 的新增列 ${id}`);
      assertFractionalIndex(insertion.order);
      if (insertion.template !== undefined
        && (!Number.isSafeInteger(insertion.template) || insertion.template < 0
          || insertion.template >= record.src.colWidths.length)) {
        throw new Error(`表格 ${record.id} 的新增列模板无效`);
      }
      if (record.src.colWidths.some((_, source) => insertion.order === initialFractionalIndex(source))) {
        throw new Error(`表格 ${record.id} 的新增列顺序与来源列冲突`);
      }
      if (orders.has(insertion.order)) throw new Error(`表格 ${record.id} 的新增列顺序重复`);
      orders.add(insertion.order);
    }
  }
  const rowIds = new Set([
    ...record.src.rows.map((_, index) => sourceTableRowId(index)),
    ...Object.keys(record.ovr.tableRows ?? {}),
  ]);
  const columnIds = new Set([
    ...record.src.colWidths.map((_, index) => sourceTableColumnId(index)),
    ...Object.keys(record.ovr.tableColumns ?? {}),
  ]);
  for (const [field, ids, kind] of [
    ['tableRemovedRows', rowIds, '行'], ['tableRemovedColumns', columnIds, '列'],
  ] as const) {
    const values = record.ovr[field];
    if (!values) continue;
    assertDataObject(values, Object.keys(values), `表格 ${record.id} 的删除${kind}`);
    if (!Object.keys(values).length) throw new Error(`表格 ${record.id} 的删除${kind}不能为空`);
    for (const [id, value] of Object.entries(values)) {
      if (!ids.has(id) || value !== true) throw new Error(`表格 ${record.id} 的删除${kind}无效：${id}`);
    }
  }
  for (const [field, ids, kind] of [
    ['tableRowHeights', rowIds, '行高'], ['tableColumnWidths', columnIds, '列宽'],
  ] as const) {
    const values = record.ovr[field];
    if (!values) continue;
    assertDataObject(values, Object.keys(values), `表格 ${record.id} 的${kind}`);
    if (!Object.keys(values).length) throw new Error(`表格 ${record.id} 的${kind}覆盖不能为空`);
    for (const [id, value] of Object.entries(values)) {
      if (!ids.has(id) || !Number.isFinite(value) || value <= 0) {
        throw new Error(`表格 ${record.id} 的${kind}无效：${id}`);
      }
    }
  }
  if (!orderedTableRows(record).length || !orderedTableColumns(record).length) {
    throw new Error(`表格 ${record.id} 至少保留一行一列`);
  }
  if (record.ovr.tableMerges !== undefined) {
    assertTableMergeRegions({
      ...record,
      ovr: { ...record.ovr, tableRemovedRows: undefined, tableRemovedColumns: undefined },
    }, record.ovr.tableMerges, `表格 ${record.id} 的合并区域`);
  }
}

export function assertTableCellOverrides(
  doc: EditDoc, record: ElementRecord,
  assertTextOverride: (value: unknown, label: string) => void,
): void {
  const cells = record.ovr.tableCells;
  if (cells === undefined) return;
  if (record.src.kind !== 'table') throw new Error(`非表格元素 ${record.id} 不能包含单元格覆盖`);
  assertDataObject(cells, Object.keys(cells), `表格 ${record.id} 的单元格覆盖`);
  const entries = Object.entries(cells);
  if (!entries.length) throw new Error(`表格 ${record.id} 的单元格覆盖不能为空`);
  const resolveCell = tableCellKeyResolver(record);
  for (const [key, value] of entries) {
    const cell = resolveCell(key);
    const stable = tableCellStableRefFromKey(record, key);
    if (!stable) {
      throw new Error(`表格 ${record.id} 的单元格覆盖坐标无效：${key}`);
    }
    // tombstone 与合并拓扑只隐藏覆盖；拆分/撤销后同一稳定格必须恢复原状态。
    if (cell && tableCellMergeRole(record, stable) !== 'placeholder') {
      textTargetContext(doc, { id: record.id, cell });
    }
    assertDataObject(value, ['text', 'fill', 'borders', 'margins', 'vAlign', 'vert'],
      `表格 ${record.id} 的单元格覆盖 ${key}`);
    if (!Reflect.ownKeys(value).length) throw new Error(`表格 ${record.id} 的单元格覆盖 ${key} 不能为空`);
    if (value.text !== undefined) {
      assertTextOverride(value.text, `表格 ${record.id} 的单元格文字覆盖 ${key}`);
    }
    if (own(value, 'fill') && value.fill !== null) {
      assertVectorFill(value.fill, `表格 ${record.id} 的单元格填充 ${key}`);
    }
    if (value.borders !== undefined) {
      assertDataObject(value.borders, ['l', 'r', 't', 'b'], `表格 ${record.id} 的单元格边框 ${key}`);
      for (const side of ['l', 'r', 't', 'b'] as const) {
        const stroke = value.borders[side];
        if (stroke !== undefined && stroke !== null) {
          assertStroke(stroke, `表格 ${record.id} 的单元格边框 ${key}.${side}`);
        }
      }
    }
    if (value.margins !== undefined
      && (value.margins.length !== 4
        || value.margins.some((part) => !Number.isFinite(part) || part < 0))) {
      throw new Error(`表格 ${record.id} 的单元格边距 ${key} 无效`);
    }
    if (value.vAlign !== undefined && !['top', 'middle', 'bottom'].includes(value.vAlign)) {
      throw new Error(`表格 ${record.id} 的单元格垂直对齐 ${key} 无效`);
    }
    if (value.vert !== undefined && !['horz', 'vert', 'vert270', 'wordArtVert'].includes(value.vert)) {
      throw new Error(`表格 ${record.id} 的单元格文字方向 ${key} 无效`);
    }
  }
}
