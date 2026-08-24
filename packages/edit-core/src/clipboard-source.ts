import type { OpcPackage } from '@web-ppt/core';
import { bytesToBase64, sha256 } from './clipboard-binary';
import type { ClipboardRelationship, ClipboardResource } from './commands/types';
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

function samePackageClosure(pkg: OpcPackage, targetPart: string) {
  const parts = new Map<string, string>();
  const visit = (part: string): void => {
    if (parts.has(part)) return;
    const bytes = pkg.parts[part];
    if (!bytes) throw new Error(`复杂对象关系目标不存在：${part}`);
    parts.set(part, sha256(bytes));
    const relsPart = relationshipPartFor(part);
    const relsBytes = pkg.parts[relsPart];
    if (!relsBytes) return;
    parts.set(relsPart, sha256(relsBytes));
    for (const node of xmlElementChildren(parseXmlTree(relsBytes).root, { localName: 'Relationship' })) {
      const mode = findXmlAttribute(node, { localName: 'TargetMode', namespaceUri: null })?.value;
      const target = findXmlAttribute(node, { localName: 'Target', namespaceUri: null })?.value;
      if (mode !== 'External' && target) visit(resolveRelationshipTarget(part, target));
    }
  };
  visit(targetPart);
  return [...parts].sort(([left], [right]) => left.localeCompare(right))
    .map(([part, hash]) => ({ part, hash }));
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

/** 只复制宿主实际引用的关系；不把整张幻灯片的无关资源塞入系统剪贴板。 */
export function clipboardClosure(pkg: OpcPackage, sourcePart: string, host: XmlElement): ClipboardClosure {
  const ids = relationshipIds(host);
  if (!ids.length) return { relationships: [], resources: [] };
  const relsPart = relationshipPartFor(sourcePart);
  const relsBytes = pkg.parts[relsPart];
  if (!relsBytes) throw new Error(`元素引用了关系，但来源 part 不存在：${relsPart}`);
  const rels = xmlElementChildren(parseXmlTree(relsBytes).root, { localName: 'Relationship' });
  const relationships: ClipboardRelationship[] = [];
  const resources = new Map<string, ClipboardResource>();
  for (const sourceId of ids) {
    const node = rels.find((candidate) =>
      findXmlAttribute(candidate, { localName: 'Id', namespaceUri: null })?.value === sourceId);
    if (!node) throw new Error(`元素引用了不存在的 OPC 关系：${sourceId}`);
    const type = findXmlAttribute(node, { localName: 'Type', namespaceUri: null })?.value;
    const target = findXmlAttribute(node, { localName: 'Target', namespaceUri: null })?.value;
    const mode = findXmlAttribute(node, { localName: 'TargetMode', namespaceUri: null })?.value;
    if (!type || !target) throw new Error(`OPC 关系缺少 Type 或 Target：${sourceId}`);
    if (mode === 'External') {
      relationships.push({ sourceId, type, target, targetMode: 'External' });
      continue;
    }
    const kind = type.slice(type.lastIndexOf('/') + 1);
    const targetPart = resolveRelationshipTarget(sourcePart, target);
    if (!MEDIA_REL_TYPES.has(kind)) {
      relationships.push({
        sourceId, type,
        packageTarget: { part: targetPart, closure: samePackageClosure(pkg, targetPart) },
      });
      continue;
    }
    const bytes = pkg.parts[targetPart];
    if (!bytes) throw new Error(`OPC 关系目标不存在：${targetPart}`);
    const extension = targetPart.slice(targetPart.lastIndexOf('.') + 1).toLowerCase();
    const hash = sha256(bytes);
    resources.set(hash, {
      hash, extension, mime: contentType(pkg, targetPart, extension), bytes: bytesToBase64(bytes),
    });
    relationships.push({ sourceId, type, resourceHash: hash });
  }
  return { relationships, resources: [...resources.values()] };
}
