import { clipboardClosure, insertionOwner } from './clipboard-source';
import type { ClipboardResource, ClipboardXmlRoot } from './commands/types';
import { activeClosures } from './commands/paste-resources';
import { materializeElementRoots, materializeInsertionFragment } from './save/insertion';
import { locateElementHosts } from './save/xfrm';
import type { EditDoc, ElementId, ElementRecord } from './types';
import { shapeIds } from './xml/shape-ids';
import { XMLNS_NS } from './xml/qname';
import { serializeXmlNode } from './xml/tree';
import type { XmlDocument, XmlElement } from './xml/types';

function namespaces(document: XmlDocument): Record<string, string> {
  return Object.fromEntries(document.root.attributes
    .filter((attribute) => attribute.namespaceUri === XMLNS_NS)
    .map((attribute) => [attribute.name, attribute.value]));
}

/** 复制取得有效树；解组只移交来源，覆盖仍由原记录持有，避免追加行等操作被执行两次。 */
export function elementTreeSources(doc: EditDoc, roots: readonly ElementId[], sourceOnly = false) {
  const sourcePart = doc.elements[roots[0]].meta.origin?.part;
  const pkg = doc.package;
  const sourceBytes = sourcePart && (doc.saveState.baselines[sourcePart] ?? pkg?.parts[sourcePart]);
  if (!sourcePart || !sourceBytes || !pkg) throw new Error('复制元素缺少可读取的 OOXML 来源 part');
  if (roots.some((id) => doc.elements[id].meta.origin?.part !== sourcePart)) {
    throw new Error('一次复制的元素树必须来自同一 OOXML part');
  }
  const hosts = new Map<ElementId, { host: XmlElement; namespaces: Record<string, string> }>();
  const inserted = new Map<ElementRecord, ElementId[]>();
  const original: ElementId[] = [];
  const contexts = new Set<ElementRecord>();
  for (const id of roots) {
    const owner = insertionOwner(doc, id);
    // 新组合只提供空容器；必须从来源树移入孩子，才能复制完整的资源闭包。
    if (!owner || owner.meta.insertion?.containsDescendants === false) {
      original.push(id);
      contexts.add(owner ?? doc.elements[id]);
    } else inserted.set(owner, [...(inserted.get(owner) ?? []), id]);
  }
  const locate = (document: XmlDocument, ids: readonly ElementId[]): void => {
    const located = locateElementHosts(document, ids.map((id) => doc.elements[id]));
    const declarations = namespaces(document);
    for (const id of ids) hosts.set(id, { host: located.get(id)!.host, namespaces: declarations });
  };
  if (original.length) {
    locate(materializeElementRoots(doc, [...contexts], sourceBytes, sourceOnly), original);
  }
  for (const [owner, ids] of inserted) locate(materializeInsertionFragment(doc, owner, sourceOnly), ids);
  const insertions = activeClosures(doc, sourcePart);
  const xmlRoots: Record<string, ClipboardXmlRoot> = Object.create(null);
  const resources = new Map<string, ClipboardResource>();
  for (const id of roots) {
    const resolved = hosts.get(id)!;
    const closure = clipboardClosure(pkg, sourcePart, resolved.host, insertions);
    for (const resource of closure.resources) resources.set(resource.hash, resource);
    xmlRoots[id] = {
      markup: serializeXmlNode(resolved.host), namespaces: { ...resolved.namespaces }, hostSpids: shapeIds(resolved.host),
      ...(closure.relationships.length ? { relationships: closure.relationships } : {}),
    };
  }
  return { ooxml: { roots: xmlRoots }, resources: [...resources.values()] };
}
