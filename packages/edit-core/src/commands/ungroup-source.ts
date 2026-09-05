import { elementTreeSources } from '../clipboard-trees';
import type { EditDoc, ElementInsertionSource, ElementRecord } from '../types';
import { prepareInsertionClosures } from './paste-resources';

/** 完整插入来源随父组删除；孩子脱离前分取自己的闭包，不能依赖已消失的活父链。 */
export function ungroupInsertionSources(doc: EditDoc, group: ElementRecord): Map<string, ElementInsertionSource> {
  const result = new Map<string, ElementInsertionSource>();
  if (!group.meta.insertion || group.meta.insertion.containsDescendants === false) return result;
  const part = group.meta.origin!.part;
  const payload = elementTreeSources(doc, group.children!, true);
  const closures = prepareInsertionClosures(doc, payload, group.children!, part);
  const modeled = new Set(Object.values(doc.elements).flatMap((record) =>
    record.meta.origin?.part === part ? [String(record.meta.origin.spid)] : []));
  for (const id of group.children!) {
    const source = payload.ooxml.roots[id];
    result.set(id, {
      markup: source.markup, namespaces: source.namespaces,
      spids: Object.fromEntries(source.hostSpids.map((spid) => [spid, Number(spid)])),
      unmodeledSpids: source.hostSpids.filter((spid) => !modeled.has(spid)).map(Number),
      ...closures.get(id)!,
    });
  }
  return result;
}
