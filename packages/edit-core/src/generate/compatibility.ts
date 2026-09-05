import type { EditDoc, ElementInsertionSource, ElementRecord } from '../types';
import { insertionOwner, relationshipIds } from '../clipboard-source';
import { materializeInsertionFragment } from '../save/insertion';
import { elementNonVisualProperties, locateElementHost } from '../save/xfrm';
import { setXmlAttribute } from '../xml/mutate';
import { XMLNS_NS } from '../xml/qname';
import { findXmlAttribute, xmlElementChildren } from '../xml/query';
import { shapeIds } from '../xml/shape-ids';
import { parseXmlTree, serializeXmlNode } from '../xml/tree';
import type { XmlElement } from '../xml/types';
import type { CompatibilityParts } from './compatibility-parts';
import { remapCompatibilityReferences } from './compatibility-references';

/** 整个 MC 外壳是一个框架对象；隐藏表示和只读组后代不能按普通图形重新生成。 */
export function compatibilityInsertion(
  doc: EditDoc, record: ElementRecord, targetPart: string, targetSpid: number,
  usedSpids: Set<number>, parts: CompatibilityParts,
): ElementInsertionSource {
  const origin = record.meta.origin ?? record.src.editInfo?.origin;
  if (!origin) throw new Error(`兼容对象 ${record.id} 缺少原包来源`);
  let parent = record.parent;
  while (doc.elements[parent]) parent = doc.elements[parent].parent;
  const sourcePart = doc.slides[parent]?.creation?.duplicateSourcePart ?? origin.part;
  const owner = insertionOwner(doc, record.id);
  const insertion = owner?.meta.insertion?.containsDescendants === false ? undefined : owner?.meta.insertion;
  const bytes = doc.saveState.baselines[sourcePart] ?? parts.source(sourcePart);
  if (!insertion && !bytes) throw new Error(`兼容对象 ${record.id} 缺少原包来源`);
  parts.registerMedia(insertion?.resources ?? []);
  const probe = { ...record, meta: { ...record.meta, editable: 'frame' as const, origin } };
  const tree = insertion
    ? materializeInsertionFragment(doc, owner!) : parseXmlTree(bytes!);
  const host = locateElementHost(tree, probe).host;
  if (insertion) remapCompatibilityReferences(host, insertion.spids);
  // 别名先收敛，再统一分配新 ID；否则未选分支会被误认为已经删除的孩子。
  const aliases: Record<string, number> = {};
  for (const node of elementNonVisualProperties(tree, probe)) {
    const id = findXmlAttribute(node, { localName: 'id', namespaceUri: null })!.value;
    aliases[id] = targetSpid;
    setXmlAttribute(node, 'id', String(origin.spid));
  }
  const spids: Record<string, number> = { [String(origin.spid)]: targetSpid };
  let next = 2;
  for (const id of shapeIds(host)) {
    if (id in spids) continue;
    while (usedSpids.has(next)) next++;
    spids[id] = next;
    usedSpids.add(next++);
  }
  remapCompatibilityReferences(host, { ...spids, ...aliases });
  const namespaces: Record<string, string> = {};
  const collectNamespaces = (node: XmlElement): boolean => {
    if (node !== host && !xmlElementChildren(node).some(collectNamespaces)) return false;
    for (const attribute of node.attributes) {
      if (attribute.namespaceUri === XMLNS_NS && !(attribute.name in namespaces)) {
        namespaces[attribute.name] = attribute.value;
      }
    }
    return true;
  };
  collectNamespaces(tree.root);
  const relations = insertion?.relationships ?? parts.relationships(sourcePart);
  const relationships = relationshipIds(host, true).map((id, index) => {
    const relation = relations.find((entry) => entry.targetId === id);
    if (!relation) throw new Error(`兼容对象缺少原包关系：${id}`);
    return parts.relocate({ ...relation, sourceId: id }, insertion ? origin.part : sourcePart,
      targetPart, `rIdCompat${targetSpid}_${index + 1}`);
  });
  return {
    markup: serializeXmlNode(host), namespaces, spids, relationships,
    unmodeledSpids: Object.values(spids).filter((id) => id !== targetSpid),
  };
}
