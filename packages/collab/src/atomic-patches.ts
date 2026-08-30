import type {
  ElementHierarchyPatch, ElementRecord, ElementTreePatch, Patch, SlideRecord, SlideTreePatch,
} from '@web-ppt/edit-core';

const unsafeKey = (key: string): boolean => key === '__proto__' || key === 'prototype' || key === 'constructor';

/**
 * Editor 禁止结构 patch 与同目标字段 patch 并列，因为删除场景会产生中间态。
 * 结构 patch 后的直属 override 写入没有这个歧义，可折进其记录快照后保持一帧 recovery 原子性。
 */
export function foldInsertedElementOverrides(patches: readonly Patch[]): Patch[] {
  const insertion = new Map<string, { index: number; record: ElementRecord }>();
  const slideInsertion = new Map<string, { index: number; record: SlideRecord }>();
  const result = patches.map((patch) => structuredClone(patch));
  patches.forEach((patch, index) => {
    let records: Readonly<Record<string, ElementRecord | null>> | null = null;
    if (patch.op === 'insert' && patch.path.length === 2 && patch.path[0] === 'elements') {
      records = (result[index] as ElementTreePatch).value.records;
    } else if (patch.op === 'set' && patch.path.length === 3 && patch.path[0] === 'elements'
      && patch.path[2] === 'hierarchy') {
      records = (result[index] as ElementHierarchyPatch).value.records;
    }
    for (const [id, record] of Object.entries(records ?? {})) {
      if (record) insertion.set(id, { index, record });
    }
    if (patch.op === 'insert' && patch.path.length === 2 && patch.path[0] === 'slides') {
      const tree = result[index] as SlideTreePatch;
      slideInsertion.set(tree.path[1], { index, record: tree.value.slide });
      for (const [id, record] of Object.entries(tree.value.records)) {
        insertion.set(id, { index, record });
      }
    }
  });
  if (!insertion.size && !slideInsertion.size) return [...patches];
  const omitted = new Set<number>();
  for (let index = 0; index < patches.length; index++) {
    const patch = patches[index];
    if (patch.path.length >= 3 && patch.path[0] === 'slides'
      && (patch.op === 'set' || patch.op === 'del')) {
      const target = slideInsertion.get(patch.path[1]);
      if (!target || target.index >= index) continue;
      const keys = patch.path.slice(2);
      if (keys.some((key) => typeof key !== 'string' || unsafeKey(key))) continue;
      let owner: Record<string, unknown> = target.record as unknown as Record<string, unknown>;
      let valid = true;
      for (const key of keys.slice(0, -1) as string[]) {
        const child = owner[key];
        if (!child || typeof child !== 'object' || Array.isArray(child)) {
          valid = false;
          break;
        }
        owner = child as Record<string, unknown>;
      }
      if (!valid) continue;
      const key = keys[keys.length - 1] as string;
      if (patch.op === 'set') owner[key] = structuredClone(patch.value);
      else delete owner[key];
      omitted.add(index);
      continue;
    }
    if (patch.path.length !== 4 || patch.path[0] !== 'elements' || patch.path[2] !== 'ovr'
      || patch.op !== 'set' && patch.op !== 'del') continue;
    if (unsafeKey(patch.path[3])) continue;
    const target = insertion.get(patch.path[1]);
    if (!target || target.index >= index) continue;
    const overrides = target.record.ovr as Record<string, unknown>;
    if (patch.op === 'set') overrides[patch.path[3]] = structuredClone(patch.value);
    else delete overrides[patch.path[3]];
    omitted.add(index);
  }
  return result.filter((_, index) => !omitted.has(index));
}
