import { assertLinkOverride } from '../hyperlink';
import type { EditDoc } from '../types';
import type { ElementLinkPatch, Patch } from './types';

export function isElementLinkPatch(patch: Patch): patch is ElementLinkPatch {
  return patch.path.length === 4 && patch.path[0] === 'elements'
    && patch.path[2] === 'ovr' && patch.path[3] === 'link';
}

export function validateElementLinkPatch(doc: EditDoc, patch: ElementLinkPatch, index: number): void {
  const record = doc.elements[patch.path[1]];
  if (!record) throw new Error(`Patch 指向不存在的元素：${patch.path[1]}`);
  if ((record.src.kind !== 'shape' && record.src.kind !== 'image')
    || record.meta.editable !== 'full') {
    throw new Error(`Patch ${index} 指向不支持链接的元素`);
  }
  if (patch.op === 'set') assertLinkOverride(patch.value, `Patch ${index} 的 link`);
}

export function applyElementLinkPatch(doc: EditDoc, patch: ElementLinkPatch): void {
  const record = doc.elements[patch.path[1]];
  if (!record) throw new Error(`Patch 指向不存在的元素：${patch.path[1]}`);
  if (patch.op === 'set') record.ovr.link = structuredClone(patch.value);
  else delete record.ovr.link;
}
