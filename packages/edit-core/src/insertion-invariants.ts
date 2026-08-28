import { assertDataObject } from './data-validation';
import { relationshipPartFor, resolveRelationshipTarget } from './clipboard-source';
import type {
  EditDoc, ElementInsertionRelationship, ElementRecord,
} from './types';
import { assertImageResource } from './commands/element-image-content';
import { findXmlAttribute, xmlElementChildren } from './xml/query';
import { parseXmlTree } from './xml/tree';

const MEDIA_REL_TYPES = new Set(['image', 'audio', 'video', 'media']);
const own = (object: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(object, key);

function relationshipSource(
  doc: EditDoc,
  part: string,
  duplicateSources: ReadonlyMap<string, string>,
): Uint8Array | undefined {
  const direct = doc.package?.parts[relationshipPartFor(part)];
  if (direct) return direct;
  const sourcePart = duplicateSources.get(part);
  if (!sourcePart) return undefined;
  const relsPart = relationshipPartFor(sourcePart);
  return doc.saveState.baselines[relsPart] ?? doc.package?.parts[relsPart];
}

function relationshipTriple(relationship: ElementInsertionRelationship): string {
  return JSON.stringify([
    relationship.type, relationship.target, relationship.targetMode ?? null,
  ]);
}

/** 结构 Patch 是公开 JSON seam；内嵌 OOXML 闭包不能依赖命令曾经正确地产生过它。 */
export function assertElementInsertionSource(doc: EditDoc, record: ElementRecord): void {
  const source = record.meta.insertion;
  if (!source) return;
  const label = `元素 ${record.id} 的插入闭包`;
  if (!record.meta.created || !record.meta.origin) throw new Error(`${label} 缺少新建宿主身份`);
  assertDataObject(source, [
    'markup', 'namespaces', 'spids', 'relationships', 'resources', 'containsDescendants',
  ], label);
  if (source.containsDescendants !== undefined && source.containsDescendants !== false) {
    throw new Error(`${label}.containsDescendants 只能显式为 false`);
  }
  if (source.containsDescendants === false && record.src.kind !== 'group') {
    throw new Error(`${label} 只有组合能使用空容器语义`);
  }
  if (typeof source.markup !== 'string' || !source.markup
    || !source.namespaces || typeof source.namespaces !== 'object' || Array.isArray(source.namespaces)
    || !source.spids || typeof source.spids !== 'object' || Array.isArray(source.spids)
    || !Array.isArray(source.relationships ?? []) || !Array.isArray(source.resources ?? [])) {
    throw new Error(`${label} 的 XML 或资源描述无效`);
  }
  if (Object.entries(source.namespaces).some(([name, value]) =>
    !/^xmlns(?::[A-Za-z_][A-Za-z0-9_.-]*)?$/.test(name) || typeof value !== 'string' || !value)
    || Object.entries(source.spids).some(([spid, value]) =>
      !/^\d+$/.test(spid) || !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error(`${label} 的命名空间或 spid 映射无效`);
  }
  const resources = source.resources ?? [];
  const byTarget = new Map<string, typeof resources[number]>();
  for (const [index, resource] of resources.entries()) {
    assertImageResource(resource, `${label}.resources[${index}]`, doc);
    if (byTarget.has(resource.targetPart)) throw new Error(`${label} 的媒体目标重复`);
    byTarget.set(resource.targetPart, resource);
  }
  const sourceIds = new Set<string>();
  const targetIds = new Set<string>();
  const referencedTargets = new Set<string>();
  const relationships = source.relationships ?? [];
  for (const [index, input] of relationships.entries()) {
    assertDataObject(input, ['sourceId', 'targetId', 'type', 'target', 'targetMode'],
      `${label}.relationships[${index}]`);
    const relationship = input as ElementInsertionRelationship;
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(relationship.sourceId)
      || sourceIds.has(relationship.sourceId)
      || !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(relationship.targetId)
      || targetIds.has(relationship.targetId)
      || typeof relationship.type !== 'string' || !relationship.type
      || typeof relationship.target !== 'string' || !relationship.target
      || (own(relationship, 'targetMode') && relationship.targetMode !== 'External')) {
      throw new Error(`${label}.relationships[${index}] 无效`);
    }
    sourceIds.add(relationship.sourceId);
    targetIds.add(relationship.targetId);
    if (relationship.targetMode === 'External') continue;
    const target = resolveRelationshipTarget(record.meta.origin.part, relationship.target);
    if (MEDIA_REL_TYPES.has(relationship.type.slice(relationship.type.lastIndexOf('/') + 1))) {
      if (!byTarget.has(target)) throw new Error(`${label} 的媒体关系缺少资源：${relationship.sourceId}`);
      referencedTargets.add(target);
    } else if (!doc.package?.parts[target] && !doc.saveState.baselines[target]) {
      throw new Error(`${label} 的包关系目标不存在：${relationship.sourceId}`);
    }
  }
  if (referencedTargets.size !== byTarget.size) throw new Error(`${label} 包含未引用的媒体资源`);
}

/** 每个宿主 part 只建一次索引，避免多图片页面的全局模型校验退化成 O(n²)。 */
export function assertActiveRelationshipTargets(doc: EditDoc): void {
  const claims = new Map<string, Map<string, { triple: string; label: string }>>();
  const reserved = new Map<string, Set<string>>();
  const duplicateSources = new Map<string, string>();
  const claim = (
    part: string,
    relationship: ElementInsertionRelationship,
    label: string,
  ): void => {
    if (reserved.get(part)?.has(relationship.targetId)) {
      throw new Error(`${label} 的目标关系 ${relationship.targetId} 与页面身份冲突`);
    }
    const byId = claims.get(part) ?? new Map<string, { triple: string; label: string }>();
    const triple = relationshipTriple(relationship);
    const previous = byId.get(relationship.targetId);
    if (previous && previous.triple !== triple) {
      throw new Error(`${label} 的目标关系 ${relationship.targetId} 与 ${previous.label} 冲突`);
    }
    byId.set(relationship.targetId, { triple, label });
    claims.set(part, byId);
  };
  for (const slide of Object.values(doc.slides)) {
    const part = slide.origin?.part;
    if (!part) continue;
    if (slide.creation) {
      const ids = reserved.get(part) ?? new Set<string>();
      ids.add(slide.creation.layoutRelationshipId);
      reserved.set(part, ids);
      if (slide.creation.duplicateSourcePart) {
        duplicateSources.set(part, slide.creation.duplicateSourcePart);
      }
    }
    for (const relationship of slide.backgroundImage?.relationships ?? []) {
      claim(part, relationship, `幻灯片 ${slide.id} 的图片背景`);
    }
  }
  for (const record of Object.values(doc.elements)) {
    const part = record.meta.origin?.part;
    if (!part) continue;
    for (const relationship of record.meta.insertion?.relationships ?? []) {
      claim(part, relationship, `元素 ${record.id} 的插入闭包`);
    }
    for (const relationship of record.meta.imageReplacement?.relationships ?? []) {
      claim(part, relationship, `元素 ${record.id} 的图片替换`);
    }
  }
  for (const [part, byId] of claims) {
    const bytes = relationshipSource(doc, part, duplicateSources);
    const existing = new Map((bytes
      ? xmlElementChildren(parseXmlTree(bytes).root, { localName: 'Relationship' }) : [])
      .flatMap((node) => {
        const id = findXmlAttribute(node, { localName: 'Id', namespaceUri: null })?.value;
        const type = findXmlAttribute(node, { localName: 'Type', namespaceUri: null })?.value;
        const target = findXmlAttribute(node, { localName: 'Target', namespaceUri: null })?.value;
        const mode = findXmlAttribute(node, { localName: 'TargetMode', namespaceUri: null })?.value;
        return id && type && target
          ? [[id, JSON.stringify([type, target, mode ?? null])] as const] : [];
      }));
    for (const [id, value] of byId) {
      const sourceTriple = existing.get(id);
      if (sourceTriple && sourceTriple !== value.triple) {
        throw new Error(`${value.label} 的目标关系 ${id} 与 OPC 冲突`);
      }
    }
  }
}
