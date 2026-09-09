import type { EditDoc } from './types';

const KEY = Symbol.for('@web-ppt/edit-core/extension-recovery/v1');
function sources(): WeakMap<EditDoc, ReadonlySet<string>> {
  const root = globalThis as typeof globalThis & { [KEY]?: WeakMap<EditDoc, ReadonlySet<string>> };
  return root[KEY] ??= new WeakMap();
}

/** 只授予隔离恢复模型旧协议校验能力；未来路由不得提前改变历史字段的写入地址。 */
export function setLegacyExtensionReplay(doc: EditDoc, pending: ReadonlySet<string>): void {
  sources().set(doc, pending);
}

export function inheritLegacyExtensionReplay(doc: EditDoc, stage: EditDoc): void {
  const pending = sources().get(doc);
  if (pending) sources().set(stage, pending);
}

export function isLegacyExtensionReplay(doc: EditDoc, id: string, namespace: string): boolean {
  const installed = doc.extensions?.['edit-addresses'] as Record<string, Record<string, unknown>> | undefined;
  return !installed?.[id]?.[namespace] && !!sources().get(doc)?.has(JSON.stringify([id, namespace]));
}
