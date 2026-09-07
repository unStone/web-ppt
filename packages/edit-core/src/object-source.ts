import { sourcePartBytes } from '@web-ppt/edit-core';
import type { EditDoc, ElementId } from './types';
import type { ChartEnv } from '@web-ppt/core';
import { parseXmlTree, xmlElementChildren } from '@web-ppt/edit-core/xml';
import type { XmlElement } from '@web-ppt/edit-core/xml';
import { chartRelationships, chartRenderContext } from './chart/context';

/** MC Choice 里的原生对象和 Fallback 可能复用 spid，必须同时匹配数据命名空间。 */
export interface ObjectSource {
  part: string;
  hostPart: string;
  xml: string;
  context: ChartEnv;
  references: Readonly<Record<string, string>>;
}
export function objectSource(doc: EditDoc, id: ElementId, namespace: string, attribute = 'id'): ObjectSource | null {
  const record = doc.elements[id], origin = record?.meta.origin;
  if (!origin || record.meta.editable !== 'frame') return null;
  let parent = record.parent;
  while (doc.elements[parent]) parent = doc.elements[parent].parent;
  const part = doc.slides[parent]?.creation?.duplicateSourcePart ?? origin.part;
  const bytes = sourcePartBytes(doc, part); if (!bytes) return null;
  const root = parseXmlTree(bytes).root, pending: XmlElement[] = [root];
  const presentation = root.namespaceUri, rels = chartRelationships(doc, part);
  while (pending.length) {
    const node = pending.pop()!;
    const elements = xmlElementChildren(node);
    if (node.localName !== 'graphicFrame' || node.namespaceUri !== presentation) { pending.push(...elements); continue; }
    const nv = elements.find((n) => n.localName === 'nvGraphicFramePr' && n.namespaceUri === presentation);
    const identity = nv && xmlElementChildren(nv).find((n) => n.localName === 'cNvPr' && n.namespaceUri === presentation);
    if (Number(identity?.attributes.find((a) => a.localName === 'id' && !a.namespaceUri)?.value) !== origin.spid) continue;
    const subtree = [...elements];
    while (subtree.length) {
      const data = subtree.pop()!;
      if (data.localName === 'graphicData' && data.attributes.some((a) => a.localName === 'uri' && !a.namespaceUri && a.value === namespace)) {
        const target = xmlElementChildren(data).find((n) => n.namespaceUri === namespace
          || namespace.endsWith('/ole') && n.namespaceUri === presentation && n.localName === 'oleObj');
        const references = Object.fromEntries((target?.attributes ?? []).filter((a) => a.namespaceUri?.endsWith('/relationships') && rels[a.value])
          .map((a) => [a.localName, rels[a.value].target]));
        const rid = target?.attributes.find((a) => a.localName === attribute && a.namespaceUri?.endsWith('/relationships'))?.value;
        const relation = rid && rels[rid], targetPart = relation && relation.target;
        const source = targetPart && sourcePartBytes(doc, targetPart);
        if (targetPart && source) return { part: targetPart, hostPart: part, references, xml: new TextDecoder().decode(source),
          context: { ...chartRenderContext(doc, id, targetPart), readPart: (path: string) => sourcePartBytes(doc, path) } };
      }
      subtree.push(...xmlElementChildren(data));
    }
  }
  return null;
}
