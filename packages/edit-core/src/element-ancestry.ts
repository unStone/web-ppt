import type { EditDoc, ElementId, ElementRecord } from './types';

/** 父链是热路径；统一环检测，避免锁定、隐藏与选区各自复制且逐渐分叉。 */
export function elementOrAncestorMatches(
  doc: EditDoc,
  id: ElementId,
  predicate: (record: ElementRecord) => boolean,
): boolean {
  let record = doc.elements[id];
  const seen = new Set<ElementId>();
  while (record) {
    if (seen.has(record.id)) throw new Error(`元素父链成环：${record.id}`);
    seen.add(record.id);
    if (predicate(record)) return true;
    record = doc.elements[record.parent];
  }
  return false;
}
