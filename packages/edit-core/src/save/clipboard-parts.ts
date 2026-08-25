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

export interface ClipboardPackageParts {
  readonly relationships: Map<string, ElementInsertionRelationship[]>;
  readonly resources: Map<string, ElementInsertionResource>;
}

export function clipboardPackageParts(doc: EditDoc): ClipboardPackageParts {
  const relationships = new Map<string, ElementInsertionRelationship[]>();
  const resources = new Map<string, ElementInsertionResource>();
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
      const activeRelationships = (closure.relationships ?? []).filter((relationship) =>
        relationship.targetId !== record.meta.imageReplacement?.suppressedRelationshipId);
      const current = relationships.get(part) ?? [];
      current.push(...activeRelationships);
      relationships.set(part, current);
      for (const resource of closure.resources ?? []) {
        const referenced = activeRelationships.some((relationship) => !relationship.targetMode
          && resolveRelationshipTarget(part, relationship.target) === resource.targetPart);
        if (!referenced) continue;
        const previous = resources.get(resource.targetPart);
        if (previous && (previous.hash !== resource.hash || previous.bytes !== resource.bytes)) {
          throw new Error(`多个剪贴板资源争用目标 part：${resource.targetPart}`);
        }
        resources.set(resource.targetPart, resource);
      }
    }
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
  const existing = new Set(xmlElementChildren(tree.root, { localName: 'Relationship' }).flatMap((node) => {
    const id = findXmlAttribute(node, { localName: 'Id', namespaceUri: null })?.value;
    return id ? [id] : [];
  }));
  for (const relationship of relationships) {
    if (existing.has(relationship.targetId)) throw new Error(`目标关系 id 冲突：${relationship.targetId}`);
    existing.add(relationship.targetId);
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
    if (existingOverride) continue;
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
