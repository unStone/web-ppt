import { base64ToBytes, sha256 } from '../clipboard-binary';
import {
  packageContentType, packageContentTypeOverride, relationshipPartFor, relativeTarget,
  resolvePackageTarget, resolveRelationshipTarget,
} from '../clipboard-source';
import type {
  EditDoc, ElementInsertionRelationship, ElementInsertionResource,
} from '../types';
import { findXmlAttribute, xmlElementChildren } from '../xml/query';
import { parseXmlTree } from '../xml/tree';
import type { ElementClipboardPayload } from './types';
import type { ClipboardClosure } from '../clipboard-source';
import type { OpcPackage } from '@web-ppt/core';

export interface PreparedInsertionClosure {
  relationships: ElementInsertionRelationship[];
  resources: ElementInsertionResource[];
}

const mediaHashes = new WeakMap<object, Map<string, string>>();

function packageMedia(doc: EditDoc): Map<string, string> {
  const pkg = doc.package!;
  const cached = mediaHashes.get(pkg);
  if (cached) return new Map(cached);
  const result = new Map<string, string>();
  for (const [part, bytes] of Object.entries(pkg.parts)) {
    if (part.startsWith('ppt/media/')) result.set(sha256(bytes), part);
  }
  mediaHashes.set(pkg, result);
  return new Map(result);
}

function activeClosures(doc: EditDoc, part?: string): PreparedInsertionClosure[] {
  const elements = Object.values(doc.elements).flatMap((record) => {
    if (part !== undefined && record.meta.origin?.part !== part) return [];
    const insertion = record.meta.insertion ? [{
      relationships: [...(record.meta.insertion.relationships ?? [])],
      resources: [...(record.meta.insertion.resources ?? [])],
    }] : [];
    const replacement = record.meta.imageReplacement;
    const resource = replacement && doc.imageResources[replacement.resourceHash];
    return [...insertion, ...(replacement && resource ? [{
      relationships: [...replacement.relationships], resources: [resource],
    }] : [])];
  });
  const backgrounds = Object.values(doc.slides).flatMap((record) => {
    if (part !== undefined && record.origin?.part !== part) return [];
    const image = record.backgroundImage;
    const resources = image?.resourceHashes.map((hash) => doc.imageResources[hash]).filter(Boolean) ?? [];
    return image && resources.length === image.resourceHashes.length
      ? [{ relationships: [...image.relationships], resources }] : [];
  });
  return [...elements, ...backgrounds];
}

function relationshipIds(doc: EditDoc, part: string): Set<string> {
  const used = new Set<string>();
  const bytes = doc.package!.parts[relationshipPartFor(part)];
  if (bytes) {
    for (const node of xmlElementChildren(parseXmlTree(bytes).root, { localName: 'Relationship' })) {
      const id = findXmlAttribute(node, { localName: 'Id', namespaceUri: null })?.value;
      if (id) used.add(id);
    }
  }
  for (const closure of activeClosures(doc, part)) {
    for (const relationship of closure.relationships) used.add(relationship.targetId);
  }
  const createdSlide = Object.values(doc.slides).find((slide) =>
    slide.origin?.part === part && slide.creation);
  if (createdSlide?.creation) used.add(createdSlide.creation.layoutRelationshipId);
  return used;
}

function resourcePrefix(mime: string): string {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'media';
}

function mediaPartAllocator(used: Set<string>): (prefix: string, extension: string) => string {
  const nextByKind = new Map<string, number>();
  for (const part of used) {
    const match = /^ppt\/media\/(image|audio|video|media)(\d+)\.([a-z0-9]+)$/.exec(part);
    if (!match) continue;
    const key = `${match[1]}|${match[3]}`;
    nextByKind.set(key, Math.max(nextByKind.get(key) ?? 1, Number(match[2]) + 1));
  }
  return (prefix, extension) => {
    const key = `${prefix}|${extension}`;
    let index = nextByKind.get(key) ?? 1;
    let part = `ppt/media/${prefix}${index}.${extension}`;
    while (used.has(part)) part = `ppt/media/${prefix}${++index}.${extension}`;
    nextByKind.set(key, index + 1);
    used.add(part);
    return part;
  };
}

function mediaAllocation(doc: EditDoc): {
  targetByHash: Map<string, string>;
  allocateMediaPart: (prefix: string, extension: string) => string;
} {
  const active = activeClosures(doc);
  const retained = Object.values(doc.imageResources);
  const targetByHash = packageMedia(doc);
  for (const resource of [...active.flatMap((closure) => closure.resources), ...retained]) {
    targetByHash.set(resource.hash, resource.targetPart);
  }
  const usedParts = new Set([
    ...Object.keys(doc.package!.parts),
    ...active.flatMap((closure) => closure.resources.map((resource) => resource.targetPart)),
    ...retained.map((resource) => resource.targetPart),
  ]);
  return { targetByHash, allocateMediaPart: mediaPartAllocator(usedParts) };
}

function relationshipIdAllocator(doc: EditDoc, destinationPart: string): () => string {
  const used = relationshipIds(doc, destinationPart);
  let serial = 1;
  return () => {
    while (used.has(`rId${serial}`)) serial++;
    const id = `rId${serial++}`;
    used.add(id);
    return id;
  };
}

function directMediaTarget(
  doc: EditDoc,
  source: Omit<ElementInsertionResource, 'targetPart' | 'created'>,
): string {
  const retained = doc.imageResources[source.hash];
  if (retained) return retained.targetPart;
  const pkg = doc.package!;
  const stem = `web-ppt-${source.hash}`;
  const session = sha256(new TextEncoder().encode(doc.identity.prefix)).slice(0, 10);
  for (let serial = 0; ; serial++) {
    const suffix = serial === 0 ? '' : serial === 1 ? `-${session}` : `-${session}-${serial}`;
    const targetPart = `ppt/media/${stem}${suffix}.${source.extension}`;
    const override = packageContentTypeOverride(pkg, targetPart);
    if (override && override !== source.mime) continue;
    const bytes = pkg.parts[targetPart];
    if (!bytes) return targetPart;
    try {
      if (sha256(bytes) === source.hash
        && packageContentType(pkg, targetPart, source.extension) === source.mime) return targetPart;
    } catch { /* 同名 part 的类型不可信时换一个确定候选。 */ }
  }
}

/** 图片替换与剪贴板共用目标 part/关系分配，避免命令伪造一棵空剪贴板树。 */
export function prepareMediaResourceClosure(
  doc: EditDoc,
  destinationPart: string,
  sourceId: string,
  type: string,
  source: Omit<ElementInsertionResource, 'targetPart' | 'created'>,
): PreparedInsertionClosure {
  if (!doc.package) throw new Error('媒体关系资源需要可写 OPC 包');
  // 上传与替换已经计算内容哈希；内容寻址名让热路径只检查一个候选，不扫描整包媒体。
  const targetPart = directMediaTarget(doc, source);
  const resource = { ...source, targetPart, created: !doc.package.parts[targetPart] };
  return {
    relationships: [{
      sourceId, targetId: relationshipIdAllocator(doc, destinationPart)(), type,
      target: relativeTarget(destinationPart, targetPart),
    }],
    resources: [resource],
  };
}

/** 继承背景来自当前包的已知宿主；按关系闭包逐项改写，不能为一次裁剪扫描整包媒体。 */
export function prepareTrustedSourceClosure(
  doc: EditDoc,
  pkg: OpcPackage,
  source: ClipboardClosure,
  sourcePart: string,
  destinationPart: string,
): PreparedInsertionClosure {
  if (!doc.package) throw new Error('继承背景关系需要可写 OPC 包');
  const bytes = pkg.parts[relationshipPartFor(sourcePart)];
  if (!bytes) throw new Error(`继承背景来源缺少关系 part：${sourcePart}`);
  const nodes = new Map(xmlElementChildren(parseXmlTree(bytes).root, { localName: 'Relationship' })
    .flatMap((node) => {
      const id = findXmlAttribute(node, { localName: 'Id', namespaceUri: null })?.value;
      return id ? [[id, node] as const] : [];
    }));
  const sourceResources = new Map(source.resources.map((resource) => [resource.hash, resource]));
  const resources = new Map<string, ElementInsertionResource>();
  const allocateRelationshipId = relationshipIdAllocator(doc, destinationPart);
  const relationships = source.relationships.map((relationship) => {
    const node = nodes.get(relationship.sourceId);
    const type = node && findXmlAttribute(node, { localName: 'Type', namespaceUri: null })?.value;
    const target = node && findXmlAttribute(node, { localName: 'Target', namespaceUri: null })?.value;
    const targetMode = node
      && findXmlAttribute(node, { localName: 'TargetMode', namespaceUri: null })?.value;
    if (!node || type !== relationship.type || !target) {
      throw new Error(`继承背景来源关系已失配：${relationship.sourceId}`);
    }
    const targetId = allocateRelationshipId();
    if (relationship.targetMode === 'External') {
      if (targetMode !== 'External' || target !== relationship.target
        || relationship.resourceHash || relationship.packageTarget) {
        throw new Error(`继承背景外部关系已失配：${relationship.sourceId}`);
      }
      return { sourceId: relationship.sourceId, targetId, type, target, targetMode: 'External' as const };
    }
    if (targetMode !== undefined) throw new Error(`继承背景内部关系已失配：${relationship.sourceId}`);
    let targetPart = resolveRelationshipTarget(sourcePart, target);
    if (relationship.resourceHash) {
      const sourceResource = sourceResources.get(relationship.resourceHash);
      if (!sourceResource) throw new Error(`继承背景媒体关系缺少资源：${relationship.sourceId}`);
      const retained = resources.get(sourceResource.hash);
      if (retained) targetPart = retained.targetPart;
      else {
        if (!pkg.parts[targetPart]) throw new Error(`继承背景媒体目标不存在：${targetPart}`);
        resources.set(sourceResource.hash, {
          ...sourceResource, targetPart, created: false,
        });
      }
    } else if (!relationship.packageTarget || !pkg.parts[targetPart]) {
      throw new Error(`继承背景包关系目标不存在：${relationship.sourceId}`);
    }
    return {
      sourceId: relationship.sourceId, targetId, type,
      target: relativeTarget(destinationPart, targetPart),
    };
  });
  return { relationships, resources: [...resources.values()] };
}

/** 来源与目标是同一 slide 时复用现有关系，裁剪不应制造未引用的新 rId。 */
export function prepareExistingSourceClosure(
  pkg: OpcPackage,
  source: ClipboardClosure,
  sourcePart: string,
): PreparedInsertionClosure {
  const relBytes = pkg.parts[relationshipPartFor(sourcePart)];
  if (!relBytes) throw new Error(`来源背景缺少关系 part：${sourcePart}`);
  const nodes = xmlElementChildren(parseXmlTree(relBytes).root, { localName: 'Relationship' });
  const sourceResources = new Map(source.resources.map((resource) => [resource.hash, resource]));
  const resources = new Map<string, ElementInsertionResource>();
  const relationships = source.relationships.map((relationship) => {
    const node = nodes.find((candidate) =>
      findXmlAttribute(candidate, { localName: 'Id', namespaceUri: null })?.value === relationship.sourceId);
    const type = node && findXmlAttribute(node, { localName: 'Type', namespaceUri: null })?.value;
    const target = node && findXmlAttribute(node, { localName: 'Target', namespaceUri: null })?.value;
    const targetMode = node
      && findXmlAttribute(node, { localName: 'TargetMode', namespaceUri: null })?.value;
    if (!node || type !== relationship.type || !target
      || (targetMode !== undefined && targetMode !== 'External')) {
      throw new Error(`来源背景关系已失配：${relationship.sourceId}`);
    }
    if (relationship.resourceHash) {
      const resource = sourceResources.get(relationship.resourceHash);
      if (!resource || targetMode) throw new Error(`来源背景媒体关系无效：${relationship.sourceId}`);
      resources.set(resource.hash, {
        ...resource, targetPart: resolveRelationshipTarget(sourcePart, target), created: false,
      });
    }
    return {
      sourceId: relationship.sourceId,
      targetId: relationship.sourceId,
      type,
      target,
      ...(targetMode === 'External' ? { targetMode: 'External' as const } : {}),
    };
  });
  return { relationships, resources: [...resources.values()] };
}

/** 先验证完整闭包并分配所有目标名；调用返回前不得触碰 EditDoc。 */
export function prepareInsertionClosures(
  doc: EditDoc,
  payload: ElementClipboardPayload,
  roots: readonly string[],
  destinationPart: string,
  options: { readonly preverifiedResourceHashes?: ReadonlySet<string> } = {},
): Map<string, PreparedInsertionClosure> {
  if (!doc.package) throw new Error('粘贴关系资源需要可写 OPC 包');
  const resourceByHash = new Map<string, ElementInsertionResource>();
  for (const resource of payload.resources) {
    if (!resource || !/^[0-9a-f]{64}$/.test(resource.hash)
      || typeof resource.mime !== 'string' || !resource.mime
      || !/^[a-z0-9]+$/.test(resource.extension)
      || typeof resource.bytes !== 'string') {
      throw new Error('剪贴板资源描述无效');
    }
    if (resourceByHash.has(resource.hash)) throw new Error(`剪贴板资源哈希重复：${resource.hash}`);
    if (!options.preverifiedResourceHashes?.has(resource.hash)) {
      let bytes: Uint8Array;
      try { bytes = base64ToBytes(resource.bytes); } catch { throw new Error('剪贴板资源不是有效 Base64'); }
      if (sha256(bytes) !== resource.hash) throw new Error(`剪贴板资源哈希不匹配：${resource.hash}`);
    }
    resourceByHash.set(resource.hash, {
      ...resource, targetPart: '', created: false,
    });
  }

  const { targetByHash, allocateMediaPart } = mediaAllocation(doc);
  const allocateRelationshipId = relationshipIdAllocator(doc, destinationPart);

  const result = new Map<string, PreparedInsertionClosure>();
  for (const root of roots) {
    const sourceRelationships = payload.ooxml.roots[root].relationships ?? [];
    const seenSourceIds = new Set<string>();
    const includedResourceHashes = new Set<string>();
    const resources: ElementInsertionResource[] = [];
    const relationships: ElementInsertionRelationship[] = [];
    for (const relationship of sourceRelationships) {
      if (!relationship || typeof relationship.sourceId !== 'string' || !relationship.sourceId
        || typeof relationship.type !== 'string' || !relationship.type
        || seenSourceIds.has(relationship.sourceId)) {
        throw new Error(`剪贴板根 ${root} 的关系描述无效`);
      }
      seenSourceIds.add(relationship.sourceId);
      const targetId = allocateRelationshipId();
      if (relationship.targetMode === 'External') {
        if (typeof relationship.target !== 'string' || !relationship.target || relationship.resourceHash
          || relationship.packageTarget) {
          throw new Error(`剪贴板外部关系无效：${relationship.sourceId}`);
        }
        relationships.push({
          sourceId: relationship.sourceId, targetId, type: relationship.type,
          target: relationship.target, targetMode: 'External',
        });
        continue;
      }
      if (relationship.packageTarget) {
        const packageTarget = relationship.packageTarget;
        if (relationship.resourceHash || relationship.target || relationship.targetMode
          || !/^[0-9a-f]{64}$/.test(packageTarget.rootHash)
          || !/^[0-9a-f]{64}$/.test(packageTarget.closureHash)) {
          throw new Error(`剪贴板同包关系无效：${relationship.sourceId}`);
        }
        const targetPart = resolvePackageTarget(doc.package, packageTarget);
        if (!targetPart) throw new Error(`复杂对象只能粘贴到拥有相同 OPC 闭包的文档：${relationship.sourceId}`);
        relationships.push({
          sourceId: relationship.sourceId, targetId, type: relationship.type,
          target: relativeTarget(destinationPart, targetPart),
        });
        continue;
      }
      if (!relationship.resourceHash || relationship.target || relationship.targetMode) {
        throw new Error(`剪贴板内部关系无效：${relationship.sourceId}`);
      }
      const source = resourceByHash.get(relationship.resourceHash);
      if (!source) throw new Error(`剪贴板关系缺少资源：${relationship.resourceHash}`);
      let targetPart = targetByHash.get(source.hash);
      if (!targetPart) {
        targetPart = allocateMediaPart(resourcePrefix(source.mime), source.extension);
        targetByHash.set(source.hash, targetPart);
      }
      const prepared = {
        ...source, targetPart, created: !doc.package.parts[targetPart],
      };
      if (!includedResourceHashes.has(prepared.hash)) {
        includedResourceHashes.add(prepared.hash);
        resources.push(prepared);
      }
      relationships.push({
        sourceId: relationship.sourceId, targetId, type: relationship.type,
        target: relativeTarget(destinationPart, targetPart),
      });
    }
    result.set(root, { relationships, resources });
  }
  return result;
}
