import type { Patch, SectionStatePatch } from '@web-ppt/edit-core';
import { desiredSlideOrder } from './slide-order';
import type { SectionMove } from './state';

/** 用全量节顺序意图重写批次最后一个节快照，使不同目标的并发移动也与到达顺序无关。 */
export function materializeSectionOrder(
  base: readonly string[], moves: ReadonlyMap<string, SectionMove>, patches: Patch[],
): Patch[] {
  let last = -1;
  for (let index = 0; index < patches.length; index++) {
    const patch = patches[index];
    if (patch.op === 'set' && patch.path.length === 4
      && patch.path[0] === 'document' && patch.path[1] === 'sections') last = index;
  }
  if (last < 0) return patches;
  const patch = patches[last] as SectionStatePatch;
  // 页与节都是稳定字符串身份 + after 锚点；复用同一个全序重放算法，避免两套 CRDT 漂移。
  const order = desiredSlideOrder(base, new Set(Object.keys(patch.value.records)), moves);
  patches[last] = { ...patch, value: { ...patch.value, order } };
  return patches;
}
