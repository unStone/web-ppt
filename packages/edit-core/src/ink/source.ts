import { sourcePartBytes } from '@web-ppt/edit-core';
import type { EditDoc } from '@web-ppt/edit-core';
import { parseXmlTree, xmlElementChildren } from '@web-ppt/edit-core/xml';
import { attr, child, children, relPart, resolvePart, R } from '../ole/container';
export const INK = 'http://www.w3.org/2003/InkML', P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
export function inkSource(doc: EditDoc, id: string): { part: string; host: string; xml: string } | null {
  const record = doc.elements[id], origin = record?.meta.origin;
  if (!origin || record.meta.editable !== 'frame') return null;
  let parent = record.parent; while (doc.elements[parent]) parent = doc.elements[parent].parent;
  const host = doc.slides[parent]?.creation?.duplicateSourcePart ?? origin.part, bytes = sourcePartBytes(doc, host), rels = sourcePartBytes(doc, relPart(host));
  if (!bytes || !rels) return null;
  const relationships = children(parseXmlTree(rels).root, 'Relationship'), pending = [parseXmlTree(bytes).root];
  while (pending.length) {
    const n = pending.pop()!; pending.push(...xmlElementChildren(n));
    if (n.namespaceUri !== P14 || n.localName !== 'contentPart') continue;
    const identity = child(child(n, 'nvContentPartPr'), 'cNvPr');
    if (!identity || Number(attr(identity, 'id')) !== origin.spid) continue;
    const rid = n.attributes.find((a) => a.namespaceUri === R && a.localName === 'id')?.value;
    const r = relationships.find((r) => attr(r, 'Id') === rid && attr(r, 'TargetMode') !== 'External'); if (!r) return null;
    const part = resolvePart(host, attr(r, 'Target') ?? ''), source = sourcePartBytes(doc, part); if (!source) return null;
    return { host, part, xml: new TextDecoder().decode(source) };
  }
  return null;
}
