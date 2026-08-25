import type { OpcPackage } from '@web-ppt/core';
import { bytesToBase64, sha256 } from './clipboard-binary';
import type { ClipboardRelationship, ClipboardResource } from './commands/types';
import type {
  ElementInsertionRelationship, ElementInsertionResource, ElementInsertionSource,
} from './types';
import { findXmlAttribute, xmlElementChildren } from './xml/query';
import { parseXmlTree } from './xml/tree';
import type { XmlElement } from './xml/types';

const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MEDIA_REL_TYPES = new Set(['image', 'audio', 'video', 'media']);

export function relationshipPartFor(part: string): string {
  const split = part.lastIndexOf('/');
  const directory = split < 0 ? '' : part.slice(0, split + 1);
  const name = split < 0 ? part : part.slice(split + 1);
  return `${directory}_rels/${name}.rels`;
}

export function relativeTarget(fromPart: string, targetPart: string): string {
  const from = fromPart.split('/').slice(0, -1);
  const target = targetPart.split('/');
  let common = 0;
  while (common < from.length && common < target.length && from[common] === target[common]) common++;
  return `${'../'.repeat(from.length - common)}${target.slice(common).join('/')}`;
}

export function resolveRelationshipTarget(fromPart: string, target: string): string {
  const clean = target.split('#', 1)[0];
  const segments = [
    ...(clean.startsWith('/') ? [] : fromPart.split('/').slice(0, -1)),
    ...clean.replace(/^\//, '').split('/'),
  ];
  const normalized: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!normalized.length) throw new Error(`OPC 关系越出包根：${target}`);
      normalized.pop();
    } else normalized.push(segment);
  }
  return normalized.join('/');
}

export interface PackageTargetIdentity {
  rootHash: string;
  closureHash: string;
}

const packageIdentities = new WeakMap<object, Map<string, PackageTargetIdentity>>();
const packagePartHashes = new WeakMap<object, Map<string, string>>();

function partHash(pkg: OpcPackage, part: string): string {
  let hashes = packagePartHashes.get(pkg);
  if (!hashes) {
    hashes = new Map();
    packagePartHashes.set(pkg, hashes);
  }
  const cached = hashes.get(part);
  if (cached) return cached;
  const bytes = pkg.parts[part];
  if (!bytes) throw new Error(`复杂对象关系目标不存在：${part}`);
  const hash = sha256(bytes);
  hashes.set(part, hash);
  return hash;
}

/** 用内容与关系图描述复杂对象；OPC 路径只参与读取，绝不进入剪贴板协议。 */
export function packageTargetIdentity(pkg: OpcPackage, targetPart: string): PackageTargetIdentity {
  let cached = packageIdentities.get(pkg);
  if (!cached) {
    cached = new Map();
    packageIdentities.set(pkg, cached);
  }
  const previous = cached.get(targetPart);
  if (previous) return previous;
  const nodes: string[] = [];
  const visited = new Set<string>();
  const visit = (part: string): void => {
    if (visited.has(part)) return;
    visited.add(part);
    const content = partHash(pkg, part);
    const relsPart = relationshipPartFor(part);
    const relsBytes = pkg.parts[relsPart];
    const relationships: string[] = [];
    for (const node of relsBytes
      ? xmlElementChildren(parseXmlTree(relsBytes).root, { localName: 'Relationship' }) : []) {
      const id = findXmlAttribute(node, { localName: 'Id', namespaceUri: null })?.value;
      const type = findXmlAttribute(node, { localName: 'Type', namespaceUri: null })?.value;
      const mode = findXmlAttribute(node, { localName: 'TargetMode', namespaceUri: null })?.value;
      const target = findXmlAttribute(node, { localName: 'Target', namespaceUri: null })?.value;
      if (!id || !type || !target) throw new Error(`复杂对象关系缺少 Id、Type 或 Target：${part}`);
      if (mode === 'External') relationships.push(JSON.stringify([id, type, 'External', target]));
      else {
        const resolved = resolveRelationshipTarget(part, target);
        relationships.push(JSON.stringify([id, type, 'Internal', partHash(pkg, resolved)]));
        visit(resolved);
      }
    }
    nodes.push(JSON.stringify({ content, relationships: relationships.sort() }));
  };
  visit(targetPart);
  const identity = {
    rootHash: partHash(pkg, targetPart),
    closureHash: sha256(new TextEncoder().encode(JSON.stringify(nodes.sort()))),
  };
  cached.set(targetPart, identity);
  return identity;
}

export function resolvePackageTarget(pkg: OpcPackage, identity: PackageTargetIdentity): string | null {
  if (!identity || !/^[0-9a-f]{64}$/.test(identity.rootHash)
    || !/^[0-9a-f]{64}$/.test(identity.closureHash)) return null;
  const candidates = Object.keys(pkg.parts).filter((part) =>
    part !== '[Content_Types].xml' && !part.includes('/_rels/') && !part.startsWith('_rels/')
      && partHash(pkg, part) === identity.rootHash).sort();
  return candidates.find((part) => packageTargetIdentity(pkg, part).closureHash === identity.closureHash) ?? null;
}

function contentType(pkg: OpcPackage, part: string, extension: string): string {
  const bytes = pkg.parts['[Content_Types].xml'];
  if (!bytes) throw new Error('PPTX 缺少 [Content_Types].xml');
  const root = parseXmlTree(bytes).root;
  const override = xmlElementChildren(root, { localName: 'Override' }).find((node) =>
    findXmlAttribute(node, { localName: 'PartName', namespaceUri: null })?.value === `/${part}`);
  const direct = override && findXmlAttribute(override, { localName: 'ContentType', namespaceUri: null })?.value;
  if (direct) return direct;
  const fallback = xmlElementChildren(root, { localName: 'Default' }).find((node) =>
    findXmlAttribute(node, { localName: 'Extension', namespaceUri: null })?.value.toLowerCase()
      === extension.toLowerCase());
  const value = fallback && findXmlAttribute(fallback, { localName: 'ContentType', namespaceUri: null })?.value;
  if (!value) throw new Error(`资源缺少 Content-Type：${part}`);
  return value;
}

function relationshipIds(host: XmlElement): string[] {
  const ids = new Set<string>();
  const visit = (element: XmlElement): void => {
    for (const attribute of element.attributes) {
      if (attribute.namespaceUri === OFFICE_REL_NS && attribute.value) ids.add(attribute.value);
    }
    for (const child of xmlElementChildren(element)) visit(child);
  };
  visit(host);
  return [...ids];
}

export interface ClipboardClosure {
  relationships: ClipboardRelationship[];
  resources: ClipboardResource[];
}

interface ResolvedClipboardRelationship {
  sourceId: string;
  type: string;
  target?: string;
  targetMode?: 'External';
  targetPart?: string;
  resource?: ClipboardResource;
}

const isMediaRelationship = (type: string): boolean =>
  MEDIA_REL_TYPES.has(type.slice(type.lastIndexOf('/') + 1));

function appendClipboardRelationship(
  pkg: OpcPackage,
  source: ResolvedClipboardRelationship,
  relationships: ClipboardRelationship[],
  resources: Map<string, ClipboardResource>,
): void {
  if (source.targetMode === 'External') {
    relationships.push({
      sourceId: source.sourceId, type: source.type, target: source.target!, targetMode: 'External',
    });
    return;
  }
  if (!source.targetPart) throw new Error(`内部关系缺少目标 part：${source.sourceId}`);
  if (!isMediaRelationship(source.type)) {
    relationships.push({
      sourceId: source.sourceId, type: source.type,
      packageTarget: packageTargetIdentity(pkg, source.targetPart),
    });
    return;
  }
  if (!source.resource) throw new Error(`媒体关系缺少资源：${source.sourceId}`);
  resources.set(source.resource.hash, source.resource);
  relationships.push({ sourceId: source.sourceId, type: source.type, resourceHash: source.resource.hash });
}

/** 只复制宿主实际引用的关系；不把整张幻灯片的无关资源塞入系统剪贴板。 */
export function clipboardClosure(
  pkg: OpcPackage,
  sourcePart: string,
  host: XmlElement,
  insertions: readonly Pick<ElementInsertionSource, 'relationships' | 'resources'>[] = [],
): ClipboardClosure {
  const ids = relationshipIds(host);
  if (!ids.length) return { relationships: [], resources: [] };
  const relsPart = relationshipPartFor(sourcePart);
  const relsBytes = pkg.parts[relsPart];
  const rels = relsBytes
    ? xmlElementChildren(parseXmlTree(relsBytes).root, { localName: 'Relationship' }) : [];
  const insertedRelationships = new Map<string, {
    relationship: ElementInsertionRelationship;
    resources: ReadonlyMap<string, ElementInsertionResource>;
  }>();
  for (const insertion of insertions) {
    const insertionResources = new Map((insertion.resources ?? [])
      .map((resource) => [resource.targetPart, resource] as const));
    for (const relationship of insertion.relationships ?? []) {
      if (insertedRelationships.has(relationship.targetId)) {
        throw new Error(`新建元素关系 id 重复：${relationship.targetId}`);
      }
      insertedRelationships.set(relationship.targetId, { relationship, resources: insertionResources });
    }
  }
  const relationships: ClipboardRelationship[] = [];
  const resources = new Map<string, ClipboardResource>();
  for (const sourceId of ids) {
    const node = rels.find((candidate) =>
      findXmlAttribute(candidate, { localName: 'Id', namespaceUri: null })?.value === sourceId);
    if (!node) {
      const inserted = insertedRelationships.get(sourceId);
      if (!inserted) throw new Error(`元素引用了不存在的 OPC 关系：${sourceId}`);
      const source = inserted.relationship;
      if (source.targetMode === 'External') {
        appendClipboardRelationship(pkg, {
          sourceId, type: source.type, target: source.target, targetMode: 'External',
        }, relationships, resources);
        continue;
      }
      const targetPart = resolveRelationshipTarget(sourcePart, source.target);
      if (!isMediaRelationship(source.type)) {
        appendClipboardRelationship(pkg, { sourceId, type: source.type, targetPart }, relationships, resources);
        continue;
      }
      const resource = inserted.resources.get(targetPart);
      if (!resource) throw new Error(`新建元素关系缺少内存资源：${targetPart}`);
      appendClipboardRelationship(pkg, {
        sourceId, type: source.type, targetPart,
        resource: {
          hash: resource.hash, mime: resource.mime, extension: resource.extension, bytes: resource.bytes,
        },
      }, relationships, resources);
      continue;
    }
    const type = findXmlAttribute(node, { localName: 'Type', namespaceUri: null })?.value;
    const target = findXmlAttribute(node, { localName: 'Target', namespaceUri: null })?.value;
    const mode = findXmlAttribute(node, { localName: 'TargetMode', namespaceUri: null })?.value;
    if (!type || !target) throw new Error(`OPC 关系缺少 Type 或 Target：${sourceId}`);
    if (mode === 'External') {
      appendClipboardRelationship(pkg, { sourceId, type, target, targetMode: 'External' }, relationships, resources);
      continue;
    }
    const targetPart = resolveRelationshipTarget(sourcePart, target);
    if (!isMediaRelationship(type)) {
      appendClipboardRelationship(pkg, { sourceId, type, targetPart }, relationships, resources);
      continue;
    }
    const bytes = pkg.parts[targetPart];
    if (!bytes) throw new Error(`OPC 关系目标不存在：${targetPart}`);
    const extension = targetPart.slice(targetPart.lastIndexOf('.') + 1).toLowerCase();
    const hash = sha256(bytes);
    appendClipboardRelationship(pkg, {
      sourceId, type, targetPart,
      resource: { hash, extension, mime: contentType(pkg, targetPart, extension), bytes: bytesToBase64(bytes) },
    }, relationships, resources);
  }
  return { relationships, resources: [...resources.values()] };
}
