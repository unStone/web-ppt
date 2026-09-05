import type { EditDoc, ElementRecord } from './types';

/** 未选兼容分支也占用同一 part 的身份空间，不能只数渲染投影。 */
export function maxElementSpid(record: Pick<ElementRecord, 'meta'>): number {
  let maximum = record.meta.origin?.spid ?? 0;
  for (const spid of Object.values(record.meta.insertion?.spids ?? {})) maximum = Math.max(maximum, spid);
  return maximum;
}

export function advanceElementSpid(doc: EditDoc, record: ElementRecord): void {
  const part = record.meta.origin?.part;
  if (!part) return;
  const next = doc.identity.nextSpid[part];
  // 首次分配仍需扫描原 XML；只推进已初始化的缓存，避免跳过未建模来源。
  if (next !== undefined) doc.identity.nextSpid[part] = Math.max(next, maxElementSpid(record) + 1);
}
