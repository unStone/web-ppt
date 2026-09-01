import type { ElementRecord } from '../types';

/**
 * 层级命令从不改解析来源；只复制可变覆盖与元数据，避免大选区为历史反复深拷贝整棵只读 src。
 */
export function cloneHierarchyRecord(record: ElementRecord): ElementRecord {
  return {
    ...record,
    ovr: structuredClone(record.ovr),
    meta: structuredClone(record.meta),
    ...(record.children ? { children: [...record.children] } : {}),
  };
}
