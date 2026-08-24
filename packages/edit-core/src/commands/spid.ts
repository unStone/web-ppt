import { parseXmlTree } from '../xml/tree';
import type { XmlElement } from '../xml/types';
import type { EditDoc } from '../types';

function maxSourceSpid(doc: EditDoc, part: string): number {
  const bytes = doc.saveState.baselines[part] ?? doc.package?.parts[part];
  if (!bytes) throw new Error(`无法读取元素目标 part：${part}`);
  let maximum = 0;
  const visit = (element: XmlElement): void => {
    if (element.localName === 'cNvPr') {
      const raw = element.attributes.find((attribute) =>
        attribute.localName === 'id' && attribute.namespaceUri === null)?.value;
      const value = raw === undefined ? NaN : Number(raw);
      if (Number.isSafeInteger(value) && value >= 0) maximum = Math.max(maximum, value);
    }
    for (const child of element.children) if (child.type === 'element') visit(child);
  };
  visit(parseXmlTree(bytes).root);
  return maximum;
}

function maxModelSpid(doc: EditDoc, part: string): number {
  return Math.max(0, ...[...Object.values(doc.elements), ...Object.values(doc.removedElements)]
    .flatMap((record) => record.meta.origin?.part === part ? [record.meta.origin.spid] : []));
}

/** 来源 XML 里还有不进入 Schema 的 cNvPr；只扫模型会在空页或未知宿主上复用 spid。 */
export function allocateElementSpid(doc: EditDoc, part: string): number {
  const cached = doc.identity.nextSpid[part];
  const next = cached ?? Math.max(maxSourceSpid(doc, part), maxModelSpid(doc, part)) + 1;
  if (!Number.isSafeInteger(next) || next <= 0) throw new Error(`目标 part 的 spid 已耗尽：${part}`);
  doc.identity.nextSpid[part] = next + 1;
  return next;
}

export function partSpidAllocator(doc: EditDoc, part: string): () => number {
  return () => allocateElementSpid(doc, part);
}
