import { base64ToBytes } from '../clipboard-binary';
import { relationshipPartFor, resolveRelationshipTarget } from '../clipboard-source';
import type {
  EditDoc, ElementInsertionRelationship, ElementInsertionResource,
} from '../types';
import { createXmlElement, insertXmlChildUnchecked } from '../xml/nodes';
import { findXmlAttribute, xmlElementChildren } from '../xml/query';
import { parseXmlTree, serializeXmlTreeBytes } from '../xml/tree';

const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

export interface MediaPackageParts {
  readonly relationships: Map<string, ElementInsertionRelationship[]>;
  readonly resources: Map<string, ElementInsertionResource>;
}

export function mediaPackageParts(doc: EditDoc): MediaPackageParts {
  const relationships = new Map<string, ElementInsertionRelationship[]>();
  const resources = new Map<string, ElementInsertionResource>();
  const collect = (
    part: string,
    closure: { readonly relationships?: readonly ElementInsertionRelationship[];
      readonly resources?: readonly ElementInsertionResource[] },
    suppressedRelationshipId?: string,
  ): void => {
    const activeRelationships = (closure.relationships ?? []).filter((relationship) =>
      relationship.targetId !== suppressedRelationshipId);
    const current = relationships.get(part) ?? [];
    current.push(...activeRelationships);
    relationships.set(part, current);
    for (const resource of closure.resources ?? []) {
      const referenced = activeRelationships.some((relationship) => !relationship.targetMode
        && resolveRelationshipTarget(part, relationship.target) === resource.targetPart);
      if (!referenced) continue;
      const previous = resources.get(resource.targetPart);
      if (previous && (previous.hash !== resource.hash || previous.bytes !== resource.bytes)) {
        throw new Error(`多个媒体资源争用目标 part：${resource.targetPart}`);
      }
      resources.set(resource.targetPart, resource);
    }
  };
  for (const record of Object.values(doc.elements)) {
    const part = record.meta.origin?.part;
    if (!part) continue;
    const replacement = record.meta.imageReplacement;
    const closures = [record.meta.insertion, replacement ? {
      relationships: replacement.relationships,
      resources: [doc.imageResources[replacement.resourceHash]!],
    } : undefined];
    for (const closure of closures) {
      if (!closure) continue;
      collect(part, closure, record.meta.imageReplacement?.suppressedRelationshipId);
    }
  }
  for (const record of Object.values(doc.slides)) {
    const part = record.origin?.part;
    const image = record.backgroundImage;
    if (!part || !image) continue;
    const imageResources = image.resourceHashes.map((hash) => doc.imageResources[hash]);
    if (imageResources.some((resource) => !resource)) {
      throw new Error(`幻灯片 ${record.id} 的图片背景资源不存在`);
    }
    collect(part, { relationships: image.relationships, resources: imageResources });
  }
  return { relationships, resources };
}

export function patchRelationshipPart(
  source: Uint8Array | undefined,
  relationships: readonly ElementInsertionRelationship[],
): Uint8Array {
  const tree = source
    ? parseXmlTree(source)
    : parseXmlTree(`<Relationships xmlns="${PACKAGE_REL_NS}"/>`);
  const existing = new Map(xmlElementChildren(tree.root, { localName: 'Relationship' }).flatMap((node) => {
    const id = findXmlAttribute(node, { localName: 'Id', namespaceUri: null })?.value;
    const type = findXmlAttribute(node, { localName: 'Type', namespaceUri: null })?.value;
    const target = findXmlAttribute(node, { localName: 'Target', namespaceUri: null })?.value;
    const mode = findXmlAttribute(node, { localName: 'TargetMode', namespaceUri: null })?.value;
    return id && type && target ? [[id, { type, target, mode }] as const] : [];
  }));
  for (const relationship of relationships) {
    const current = existing.get(relationship.targetId);
    if (current) {
      if (current.type === relationship.type && current.target === relationship.target
        && current.mode === relationship.targetMode) continue;
      throw new Error(`目标关系 id 冲突：${relationship.targetId}`);
    }
    existing.set(relationship.targetId, {
      type: relationship.type, target: relationship.target, mode: relationship.targetMode,
    });
    insertXmlChildUnchecked(tree.root, createXmlElement('Relationship', {
      attributes: [
        ['Id', relationship.targetId],
        ['Type', relationship.type],
        ['Target', relationship.target],
        ...(relationship.targetMode ? [['TargetMode', relationship.targetMode] as const] : []),
      ],
    }));
  }
  return serializeXmlTreeBytes(tree);
}

export function patchContentTypes(
  source: Uint8Array | undefined,
  resources: readonly ElementInsertionResource[],
): Uint8Array {
  const tree = source
    ? parseXmlTree(source)
    : parseXmlTree(`<Types xmlns="${CONTENT_TYPES_NS}"/>`);
  const defaults = xmlElementChildren(tree.root, { localName: 'Default' });
  const overrides = xmlElementChildren(tree.root, { localName: 'Override' });
  for (const resource of resources) {
    const existingDefault = defaults.find((node) =>
      findXmlAttribute(node, { localName: 'Extension', namespaceUri: null })?.value.toLowerCase()
        === resource.extension.toLowerCase());
    const defaultMime = existingDefault
      && findXmlAttribute(existingDefault, { localName: 'ContentType', namespaceUri: null })?.value;
    if (defaultMime === resource.mime) continue;
    const partName = `/${resource.targetPart}`;
    const existingOverride = overrides.find((node) =>
      findXmlAttribute(node, { localName: 'PartName', namespaceUri: null })?.value === partName);
    if (existingOverride) {
      const overrideMime = findXmlAttribute(existingOverride, {
        localName: 'ContentType', namespaceUri: null,
      })?.value;
      if (overrideMime !== resource.mime) {
        throw new Error(`媒体资源与既有 Content-Type Override 冲突：${resource.targetPart}`);
      }
      continue;
    }
    const element = createXmlElement(existingDefault ? 'Override' : 'Default', {
      attributes: existingDefault
        ? [['PartName', partName], ['ContentType', resource.mime]]
        : [['Extension', resource.extension], ['ContentType', resource.mime]],
    });
    insertXmlChildUnchecked(tree.root, element);
    if (existingDefault) overrides.push(element); else defaults.push(element);
  }
  return serializeXmlTreeBytes(tree);
}

export function resourceBytes(resource: ElementInsertionResource): Uint8Array {
  return base64ToBytes(resource.bytes);
}

export { relationshipPartFor };
