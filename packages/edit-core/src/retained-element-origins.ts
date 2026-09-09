import type { EditDoc, ElementRecord } from './types';

/** 从当前活树保留身份，不信任删除快照中的旧覆盖；旧恢复日志也经过同一入口。 */
export function retainElementOrigins(doc: EditDoc, records: Iterable<ElementRecord>): void {
  let retained: EditDoc['retainedElementOrigins'];
  for (const record of records) {
    const origin = record.meta.origin;
    // 原生框架的领域数据可由其他框架继续引用；普通形状不需要在删除后常驻另一份身份。
    if (!origin || record.meta.editable !== 'frame') continue;
    const known = doc.retainedElementOrigins?.[record.id];
    if (known?.part === origin.part && known.spid === origin.spid) continue;
    if (known) throw new Error(`元素 ${record.id} 的来源身份已改变`);
    let parent = record.parent;
    while (doc.elements[parent]) parent = doc.elements[parent].parent;
    const sourcePart = doc.slides[parent]?.creation?.duplicateSourcePart;
    retained ??= { ...doc.retainedElementOrigins };
    retained[record.id] = { ...origin, ...(sourcePart ? { sourcePart } : {}) };
  }
  // 写时复制让结构验证暂存与真实文档隔离；不复制 src、ovr 或原页树。
  if (retained) doc.retainedElementOrigins = retained;
}

/** 恢复后的活树重新提供身份；不让多次撤销留下另一份常驻索引。 */
export function restoreElementOrigins(doc: EditDoc, records: Iterable<ElementRecord>): void {
  let retained: EditDoc['retainedElementOrigins'];
  for (const record of records) {
    const known = doc.retainedElementOrigins?.[record.id];
    if (!known) continue;
    const origin = record.meta.origin;
    if (known.part !== origin?.part || known.spid !== origin.spid) {
      throw new Error(`元素 ${record.id} 的恢复来源身份不一致`);
    }
    retained ??= { ...doc.retainedElementOrigins };
    delete retained[record.id];
  }
  if (!retained) return;
  if (Object.keys(retained).length) doc.retainedElementOrigins = retained;
  else delete doc.retainedElementOrigins;
}

export function assertRetainedElementOrigins(doc: EditDoc): void {
  const retained = doc.retainedElementOrigins;
  if (retained === undefined) return;
  if (!retained || typeof retained !== 'object' || Array.isArray(retained)) {
    throw new Error('保留来源身份表无效');
  }
  const anchors = new Map<string, string>();
  for (const [id, origin] of Object.entries(retained)) {
    if (!id || !origin || typeof origin.part !== 'string' || !origin.part
      || !Number.isSafeInteger(origin.spid) || origin.spid <= 0
      || origin.sourcePart !== undefined && (typeof origin.sourcePart !== 'string' || !origin.sourcePart)) {
      throw new Error('保留来源身份无效');
    }
    const key = `${origin.part}#${origin.spid}`, known = anchors.get(key);
    if (known && known !== id) throw new Error(`保留来源身份重复：${key}`);
    anchors.set(key, id);
    const current = (doc.elements[id] ?? doc.removedElements[id])?.meta.origin;
    if (current && (current.part !== origin.part || current.spid !== origin.spid)) {
      throw new Error(`元素 ${id} 的保留来源身份不一致`);
    }
  }
  for (const record of Object.values(doc.elements)) {
    const origin = record.meta.origin;
    if (!origin || record.meta.editable === 'none') continue;
    const id = anchors.get(`${origin.part}#${origin.spid}`);
    if (id && id !== record.id) throw new Error(`来源宿主已分配给元素 ${id}`);
  }
}
