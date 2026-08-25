import { isElementImageReplacementPatch } from './commands/element-image-content';
import { isSlideBackgroundImagePatch } from './commands/slide-property';
import type { HistoryEntry, Patch } from './commands/types';
import type { EditDoc } from './types';

function collectHashes(value: unknown, output: Set<string>, seen: WeakSet<object>): void {
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
  const seen = new WeakSet<object>();
  for (const entry of entries) for (const patch of [...entry.forward, ...entry.inverse]) {
    if ('value' in patch) collectHashes(patch.value, output, seen);
  }
  return output;
}

export function activeImageResourceHashes(doc: EditDoc): Set<string> {
  return new Set([
    ...Object.values(doc.elements).flatMap((record) =>
      record.meta.imageReplacement ? [record.meta.imageReplacement.resourceHash] : []),
    ...Object.values(doc.slides).flatMap((record) =>
      record.backgroundImage ? record.backgroundImage.resourceHashes : []),
  ]);
}

export function imageReachabilityMayChange(patches: readonly Patch[]): boolean {
  return patches.some((patch) => isElementImageReplacementPatch(patch)
    || isSlideBackgroundImagePatch(patch)
    || (patch.path.length === 2 && (patch.path[0] === 'elements' || patch.path[0] === 'slides')));
}
