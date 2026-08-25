import { own } from '../data-validation';
import { normalizeLinkTarget, queryElementLink } from '../hyperlink';
import type { EditDoc, LinkOverride } from '../types';
import type { CommandPatches, ElementLinkPatch, SetLinkCommand } from './types';

export function setLinkPatches(
  doc: EditDoc,
  command: SetLinkCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能修改链接');
  const record = doc.elements[command.id];
  if (!record) throw new Error(`找不到元素：${command.id}`);
  if ((record.src.kind !== 'shape' && record.src.kind !== 'image')
    || record.meta.editable !== 'full') {
    throw new Error(`元素不支持链接：${command.id}`);
  }
  if (record.meta.locked) throw new Error(`元素已锁定：${command.id}`);
  const path = ['elements', command.id, 'ovr', 'link'] as const;
  const hadOverride = own(record.ovr, 'link');
  if (command.target === null) {
    if (!hadOverride) return { forward: [], inverse: [] };
    return {
      forward: [{ op: 'del', path, origin }],
      inverse: [{ op: 'set', path, value: structuredClone(record.ovr.link!), origin }],
    };
  }
  const value = normalizeLinkTarget(doc, command.target, 'SetLink.target');
  const current = hadOverride ? record.ovr.link : queryElementLink(doc, [command.id]).value;
  if (JSON.stringify(current) === JSON.stringify(value)) return { forward: [], inverse: [] };
  const forward: ElementLinkPatch = { op: 'set', path, value: structuredClone(value), origin };
  const inverse: ElementLinkPatch = hadOverride
    ? { op: 'set', path, value: structuredClone(record.ovr.link as LinkOverride), origin }
    : { op: 'del', path, origin };
  return { forward: [forward], inverse: [inverse] };
}
