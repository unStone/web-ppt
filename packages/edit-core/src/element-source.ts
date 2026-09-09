import type { EditDoc, ElementId } from './types';
import { insertionOwner, resolveRelationshipTarget } from './clipboard-source';
import { sourcePartBytes } from './session-assets';
import { materializeInsertionFragment } from './save/insertion';
import { serializeXmlTreeBytes } from './xml/tree';

/** 按需读取原生宿主；插入片段的身份与关系已映射到当前文稿，无需先保存重开。 */
export function sourceElementXml(doc: EditDoc, id: ElementId) {
  const origin = doc.elements[id]?.meta.origin;
  if (!origin) return;
  const owner = insertionOwner(doc, id);
  const relationships: Record<string, { type: string; target: string; external?: true }> = Object.create(null);
  if (owner?.meta.insertion && owner.meta.insertion.containsDescendants !== false) {
    for (const relation of owner.meta.insertion.relationships ?? []) {
      const external = relation.targetMode === 'External';
      relationships[relation.targetId] = { type: relation.type,
        target: external ? relation.target : resolveRelationshipTarget(origin.part, relation.target),
        ...(external ? { external: true as const } : {}) };
    }
    return { part: origin.part, bytes: serializeXmlTreeBytes(materializeInsertionFragment(doc, owner, true)), relationships };
  }
  let parent = doc.elements[id].parent;
  while (doc.elements[parent]) parent = doc.elements[parent].parent;
  const part = doc.slides[parent]?.creation?.duplicateSourcePart ?? origin.part;
  const bytes = sourcePartBytes(doc, part);
  return bytes ? { part, bytes, relationships } : undefined;
}
