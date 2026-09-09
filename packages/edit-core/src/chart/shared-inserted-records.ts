import type { DocumentExtensionPatch } from '../commands/types';
import type { SharedGroup } from './shared-graph';
import type { FractionalIndex } from '../types';
import type { SharedCategoryFamily } from './shared-family';
import { sharedFamilyByKey } from './shared-family';
import { assertChartDictionary, assertChartIdentity, assertChartName, assertChartOrder, MAX_CHART_CELLS } from './validation';
import { sharedCellAddress } from './shared-rows';
import { compareChartOrder } from './ordering';

export interface InsertedRow {
  readonly id: string;
  readonly anchor: number;
  readonly order: FractionalIndex;
  readonly parent?: string | null;
  readonly removed?: true;
  readonly cells?: Readonly<Record<string, string | number | null>>;
}
export type InsertedRows = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

function validateLeaf(family: SharedCategoryFamily, id: string, tail: readonly string[], value: unknown, deleted: boolean): void {
  assertChartIdentity(id, id, '共享新增类别');
  const charts = [...new Set([...family.charts, ...family.xyOwners.map(owner => owner.chart)])];
  if (charts.some(chart => id in chart.state.categories || id in chart.state.series
    || Object.values(chart.state.series).some(series => id in series.points))) throw new Error('共享新增类别与来源身份冲突');
  if (tail.length === 2 && tail[0] === 'cells') {
    const lane = Number(tail[1]);
    if (String(lane) !== tail[1] || !family.lanes.has(lane)) throw new Error('共享新增类别单元格不属于记录轴');
    if (deleted || value === null) return;
    const fields = charts.flatMap(chart => chart.fields).filter(field => {
      if (!family.keys.has(field.key)) return false;
      const cell = sharedCellAddress(field.key); return (family.horizontal ? cell.row : cell.column) === lane;
    });
    if ((family.numericLanes.has(lane) || fields.some(field => field.kind === 'number')) && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error('共享新增类别数值必须是有限数字或空值');
    }
    if (typeof value === 'string') assertChartName(value, '共享新增类别文本');
    else if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('共享新增类别单元格类型无效');
    return;
  }
  if (tail.length !== 1 || !['id', 'anchor', 'order', 'parent', 'removed'].includes(tail[0])) throw new Error('共享新增类别字段无效');
  if (deleted) return;
  if (tail[0] === 'id') assertChartIdentity(value, id, '共享新增类别');
  if (tail[0] === 'order') assertChartOrder(value, '共享新增类别顺序');
  if (tail[0] === 'parent' && value !== null) assertChartIdentity(value, value as string, '共享新增类别父级');
  if (tail[0] === 'anchor' && !family.anchors.has(value as number)) {
    throw new Error('共享新增类别锚点不属于来源记录轴');
  }
  if (tail[0] === 'removed' && value !== true) throw new Error('共享新增类别删除标记无效');
}

export function validateInsertedPatch(shared: SharedGroup, patch: DocumentExtensionPatch): void {
  if (patch.path.length < 8) throw new Error('共享新增类别路径无效');
  validateLeaf(sharedFamilyByKey(shared, patch.path[5]), patch.path[6], patch.path.slice(7),
    patch.op === 'set' ? patch.value : undefined, patch.op === 'del');
}

export function validateInsertedRows(shared: SharedGroup, value: unknown): void {
  assertChartDictionary(value, '共享新增类别区域');
  let count = 0;
  for (const [key, raw] of Object.entries(value)) {
    const family = sharedFamilyByKey(shared, key); assertChartDictionary(raw, '共享新增类别记录');
    for (const [id, row] of Object.entries(raw)) {
      assertChartDictionary(row, '共享新增类别');
      for (const [field, content] of Object.entries(row)) {
        const leaves = field === 'cells' ? (assertChartDictionary(content, '共享新增类别单元格'), Object.entries(content)) : [['', content]];
        for (const [lane, cell] of leaves) {
          if (++count > MAX_CHART_CELLS) throw new Error('共享新增类别覆盖超过安全上限');
          validateLeaf(family, id, field === 'cells' ? [field, String(lane)] : [field], cell, false);
        }
      }
    }
  }
}

export function insertedRows(family: Pick<SharedCategoryFamily, 'key'>, insertions: InsertedRows | undefined): InsertedRow[] {
  const rows = Object.entries(insertions?.[family.key] ?? {}).map(([id, raw]) => {
    const row = raw as InsertedRow;
    if (row.id !== id || !Number.isInteger(row.anchor) || typeof row.order !== 'string') {
      throw new Error('共享新增类别字段尚未完整');
    }
    return row;
  }).sort((a, b) => a.anchor - b.anchor || compareChartOrder(a, b));
  const previous = new Map<string, InsertedRow>();
  for (const row of rows) {
    if (row.parent && previous.get(row.parent)?.anchor !== row.anchor) throw new Error('共享新增类别父级引用尚未完整或顺序无效');
    previous.set(row.id, row);
  }
  return rows;
}
