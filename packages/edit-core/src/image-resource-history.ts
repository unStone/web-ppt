import { isElementImageReplacementPatch, isImageResourcePatch } from './commands/element-image-content';
import { assertPatchCount } from './commands/patch-count';
import { isElementTextPatch } from './commands/element-text';
import { isSlideBackgroundImagePatch } from './commands/slide-property';
import type { HistoryEntry, Patch } from './commands/types';
import type { EditDoc } from './types';

/** 接收端没有本地历史，撤销后可以回收图片；传输引用必须同时补齐内容寻址资源。 */
export function imageResourcePatchClosure(doc: EditDoc, patches: readonly Patch[], origin: string): Patch[] {
  const hashes = new Set<string>();
  collectHashes(patches, hashes, new WeakSet());
  for (const patch of patches) if (isImageResourcePatch(patch)) hashes.delete(patch.path[1]);
  const resources: Patch[] = [];
  for (const hash of hashes) {
    const value = doc.imageResources[hash];
    if (value) resources.push({ op: 'set', path: ['imageResources', hash], value, origin });
  }
  assertPatchCount(resources.length + patches.length);
  return [...resources, ...patches];
}

const entryHashes = new WeakMap<HistoryEntry, readonly string[]>();

function collectHashes(value: unknown, output: Set<string>, seen: WeakSet<object>): void {
  if (typeof value === 'string') {
    const token = /^web-ppt-resource:([0-9a-f]{64})$/.exec(value)?.[1];
    if (token) output.add(token);
    return;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  const record = value as Record<string, unknown>;
  if (typeof record.resourceHash === 'string' && /^[0-9a-f]{64}$/.test(record.resourceHash)) {
    output.add(record.resourceHash);
  }
  if (Array.isArray(record.resourceHashes)) {
    for (const hash of record.resourceHashes) {
      if (typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash)) output.add(hash);
    }
  }
  for (const child of Object.values(record)) collectHashes(child, output, seen);
}

/** 结构历史也可能包住整棵元素快照，因此不能只识别直接 imageReplacement Patch。 */
export function historyImageResourceHashes(entries: readonly HistoryEntry[]): Set<string> {
  const output = new Set<string>();
  for (const entry of entries) {
    let hashes = entryHashes.get(entry);
    if (!hashes) {
      const collected = new Set<string>();
      const seen = new WeakSet<object>();
      for (const patch of [...entry.forward, ...entry.inverse]) {
        if ('value' in patch) collectHashes(patch.value, collected, seen);
      }
      hashes = [...collected];
      entryHashes.set(entry, hashes);
    }
    for (const hash of hashes) output.add(hash);
  }
  return output;
}

export function activeImageResourceHashes(doc: EditDoc): Set<string> {
  const output = new Set<string>();
  const seen = new WeakSet<object>();
  for (const record of Object.values(doc.elements)) {
    collectHashes(record.meta.imageReplacement, output, seen);
    collectHashes(record.ovr, output, seen);
    const source = record.src;
    collectHashes(source.kind === 'image' ? source.src
      : source.kind === 'shape' && source.fill?.type === 'image' ? source.fill.src : null, output, seen);
  }
  for (const record of Object.values(doc.slides)) collectHashes(record.backgroundImage, output, seen);
  // 生成式新图片没有 OOXML insertion 闭包，资源只由上面的 Schema token 引用。
  return output;
}

export function imageReachabilityMayChange(patches: readonly Patch[]): boolean {
  return patches.some((patch) => isElementImageReplacementPatch(patch)
    || isSlideBackgroundImagePatch(patch)
    || isElementTextPatch(patch)
    || (patch.path.length === 2 && (patch.path[0] === 'elements' || patch.path[0] === 'slides')));
}
