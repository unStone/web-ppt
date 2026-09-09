import type { DocumentExtensionPatch } from '../commands/types';
import type { SharedGroup } from './shared-graph';
import type { SharedXYFamily } from './shared-xy-family';
import { sharedXYFamilyByKey, sharedXYCell } from './shared-xy-family';
import { assertChartDictionary, assertChartIdentity, assertChartNumber, assertChartOrder, MAX_CHART_CELLS } from './validation';
import { insertedRows } from './shared-inserted-records';
import { recordAxisLayout } from './shared-record-axis';
import type { InsertedResource } from './shared-inserted-project';

export interface XYAxisRecords {
  readonly insertions?: Readonly<Record<string, unknown>>;
  readonly removed?: Readonly<Record<string, unknown>>;
}
export type SharedXYRecords = Readonly<Record<string, XYAxisRecords>>;
export interface XYResource extends InsertedResource { readonly xyRecords?: SharedXYRecords }

function validateLeaf(family: SharedXYFamily, tail: readonly string[], value: unknown, deleted: boolean): void {
  if (tail[0] === 'removed') {
    if (tail.length !== 2 || String(Number(tail[1])) !== tail[1] || !family.positions.has(Number(tail[1]))
      || !deleted && value !== true) throw new Error('共享 XY 删除位置不是来源记录');
    return;
  }
  if (tail[0] !== 'insertions') throw new Error('共享 XY 记录字段无效');
  const id = tail[1]; assertChartIdentity(id, id, '共享 XY 新增点');
  if (family.identities.has(id)) throw new Error('共享 XY 新增点与来源身份冲突');
  if (tail[2] === 'cells') {
    if (tail.length !== 4 || String(Number(tail[3])) !== tail[3] || !family.lanes.has(Number(tail[3]))) {
      throw new Error('共享 XY 单元格不属于记录轴');
    }
    if (!deleted) assertChartNumber(value, '共享 XY 数值');
    return;
  }
  if (tail.length !== 3 || !['id', 'anchor', 'order', 'removed'].includes(tail[2])) throw new Error('共享 XY 新增点字段无效');
  if (deleted) return;
  if (tail[2] === 'id') assertChartIdentity(value, id, '共享 XY 新增点');
  if (tail[2] === 'order') assertChartOrder(value, '共享 XY 顺序');
  if (tail[2] === 'anchor' && !family.anchors.has(value as number)) throw new Error('共享 XY 锚点不是来源记录位置');
  if (tail[2] === 'removed' && value !== true) throw new Error('共享 XY 删除标记无效');
}

export function validateXYPatch(shared: SharedGroup, patch: DocumentExtensionPatch): void {
  validateLeaf(sharedXYFamilyByKey(shared, patch.path[5]), patch.path.slice(6), patch.op === 'set' ? patch.value : undefined, patch.op === 'del');
}

export function validateXYRecords(shared: SharedGroup, records: unknown): void {
  assertChartDictionary(records, '共享 XY 记录轴');
  let count = 0;
  const visit = (family: SharedXYFamily, raw: unknown, path: string[]) => {
    assertChartDictionary(raw, '共享 XY 记录');
    for (const [key, value] of Object.entries(raw)) {
      if (++count > MAX_CHART_CELLS) throw new Error('共享 XY 覆盖超过安全上限');
      const tail = [...path, key];
      const container = tail.length === 1 && ['removed', 'insertions'].includes(key)
        || tail[0] === 'insertions' && (tail.length === 2 || tail.length === 3 && key === 'cells');
      if (container) visit(family, value, tail); else validateLeaf(family, tail, value, false);
    }
  };
  for (const [key, record] of Object.entries(records)) visit(sharedXYFamilyByKey(shared, key), record, []);
}

export function xyRecordLayout(family: SharedXYFamily, records: XYAxisRecords) {
  const rows = insertedRows(family, { [family.key]: records.insertions ?? {} });
  return { ...recordAxisLayout(family, rows, new Set(Object.keys(records.removed ?? {}).map(Number))),
    key: (lane: number, axis: number) => sharedXYCell(family, lane, axis) };
}
