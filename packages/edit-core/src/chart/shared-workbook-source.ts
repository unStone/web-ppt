import type { EditDoc } from '../types';
import { chartSourceBytes } from './context';
import { occupiedCells, unzipWorkbook, workbookMap } from './workbook';
import { readWorkbookCells, workbookCellKey } from './workbook-read';

const sources = new WeakMap<Uint8Array, ReturnType<typeof readSource>>();
function readSource(bytes: Uint8Array) {
  const parts = unzipWorkbook(bytes), map = workbookMap(parts);
  const baseline = readWorkbookCells(parts, map), occupancy = occupiedCells(parts, map);
  // 空白的合并格、公式覆盖区和元数据仍有所有者，不能被新增系列或删行压紧吞掉。
  for (const [sheet, addresses] of occupancy.occupied) for (const address of addresses) {
    const key = workbookCellKey(sheet, address), value = baseline.get(key);
    if (!value || value.kind === 'blank') baseline.set(key, { kind: 'unsupported', value: null });
  }
  for (const kind of [occupancy.merged, occupancy.unsafe]) for (const [sheet, addresses] of kind) {
    for (const address of addresses) baseline.set(workbookCellKey(sheet, address), { kind: 'unsupported', value: null });
  }
  return { parts, map, baseline };
}

export function sharedWorkbookSource(doc: EditDoc, part: string) {
  const bytes = chartSourceBytes(doc, part);
  if (!bytes) throw new Error(`共享工作簿不存在：${part}`);
  let source = sources.get(bytes);
  if (!source) { source = readSource(bytes); sources.set(bytes, source); }
  return source;
}
