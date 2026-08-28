import { isElementImageReplacementPatch } from './commands/element-image-content';
import { isSlideBackgroundImagePatch } from './commands/slide-property';
import type { HistoryEntry, Patch } from './commands/types';
import type { EditDoc } from './types';

const entryHashes = new WeakMap<HistoryEntry, readonly string[]>();

function resourceTokenHash(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^web-ppt-resource:([0-9a-f]{64})$/.exec(value)?.[1] ?? null;
}

function collectHashes(value: unknown, output: Set<string>, seen: WeakSet<object>): void {
  if (typeof value === 'string') {
    const token = resourceTokenHash(value);
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
  const output = new Set([
    ...Object.values(doc.elements).flatMap((record) => {
      const hashes = record.meta.imageReplacement ? [record.meta.imageReplacement.resourceHash] : [];
      const source = record.src;
      const token = source.kind === 'image' ? resourceTokenHash(source.src)
        : source.kind === 'shape' && source.fill?.type === 'image'
          ? resourceTokenHash(source.fill.src) : null;
      return token ? [...hashes, token] : hashes;
    }),
    ...Object.values(doc.slides).flatMap((record) =>
      record.backgroundImage ? record.backgroundImage.resourceHashes : []),
  ]);
  // 生成式新图片没有 OOXML insertion 闭包，资源只由上面的 Schema token 引用。
  return output;
}

export function imageReachabilityMayChange(patches: readonly Patch[]): boolean {
  return patches.some((patch) => isElementImageReplacementPatch(patch)
    || isSlideBackgroundImagePatch(patch)
    || (patch.path.length === 2 && (patch.path[0] === 'elements' || patch.path[0] === 'slides')));
}
