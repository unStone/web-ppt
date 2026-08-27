import { readImageMetadata, type Fill } from '@web-ppt/core';
import { base64ToBytes } from '../clipboard-binary';
import { assertDataObject } from '../data-validation';
import { assertImageCrop } from '../image-content';
import { assertVectorFill } from '../shape-fill';
import { assertStoredSlideTransition } from '../slide-transition';
import { assertStoredSlideAnimations } from '../slide-animation';
import type {
  EditDoc, ElementInsertionRelationship, ElementInsertionResource, SlideImageBackground, SlideRecord,
} from '../types';
import {
  packageTargetIdentity, relationshipPartFor, resolveRelationshipTarget,
} from '../clipboard-source';
import { findXmlAttribute, findXmlChild, xmlElementChildren } from '../xml/query';
import { DRAWINGML_NS, PRESENTATIONML_NS } from '../xml/qname';
import { parseXmlTree } from '../xml/tree';
import { sourceImageBackground } from '../slide-background-source';
import { assertUploadImageResource } from './element-image-content';
import { normalizeSlideImageTile } from './slide-image';
import type {
  Patch, SlideAnimationsPatch, SlideBackgroundImagePatch, SlideBackgroundPatch, SlideHiddenPatch,
  SlidePropertyPatch, SlideTransitionPatch,
} from './types';

const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
export const UPLOAD_BACKGROUND_SOURCE_ID = 'rIdSlideBackground';

function samePackageTarget(
  left: { readonly rootHash: string; readonly closureHash: string },
  right: { readonly rootHash: string; readonly closureHash: string },
): boolean {
  return left.rootHash === right.rootHash && left.closureHash === right.closureHash;
}

function assertSourceClosure(
  doc: EditDoc,
  record: SlideRecord,
  background: SlideImageBackground,
  resources: Readonly<Record<string, ElementInsertionResource>>,
  label: string,
): void {
  if (background.sourcePart === undefined) {
    const relationship = background.relationships[0];
    const resource = resources[background.resourceHash];
    if (background.relationships.length !== 1 || background.resourceHashes.length !== 1
      || !relationship || relationship.sourceId !== UPLOAD_BACKGROUND_SOURCE_ID
      || relationship.type !== IMAGE_REL || relationship.targetMode !== undefined
      || !/^rId\d+$/.test(relationship.targetId) || !resource) {
      throw new Error(`${label} 的上传关系闭包无效`);
    }
    assertUploadImageResource(resource, `${label} 的上传图片`);
    return;
  }
  if (typeof background.sourcePart !== 'string' || !background.sourcePart) {
    throw new Error(`${label} 的来源 part 无效`);
  }
  const source = sourceImageBackground(doc, record);
  if (!source || source.part !== background.sourcePart) {
    throw new Error(`${label} 不是当前页面的真实图片背景来源`);
  }
  const expected = new Map(source.closure.relationships.map((relationship) => [relationship.sourceId, relationship]));
  const mapped = new Map(background.relationships.map((relationship) => [relationship.sourceId, relationship]));
  const expectedHashes = new Set(source.closure.resources.map((resource) => resource.hash));
  if (expected.size !== mapped.size || expectedHashes.size !== background.resourceHashes.length
    || background.resourceHashes.some((hash) => !expectedHashes.has(hash))) {
    throw new Error(`${label} 与来源关系资源闭包不一致`);
  }
  for (const [sourceId, relationship] of expected) {
    const target = mapped.get(sourceId);
    if (!target || target.type !== relationship.type) {
      throw new Error(`${label} 的来源关系 ${sourceId} 已被改写`);
    }
    if (relationship.targetMode === 'External') {
      if (target.targetMode !== 'External' || target.target !== relationship.target) {
        throw new Error(`${label} 的外部来源关系 ${sourceId} 已被改写`);
      }
      continue;
    }
    if (target.targetMode !== undefined) throw new Error(`${label} 的内部来源关系 ${sourceId} 无效`);
    const targetPart = resolveRelationshipTarget(record.origin!.part, target.target);
    if (relationship.resourceHash) {
      const resource = resources[relationship.resourceHash];
      if (!resource || resource.targetPart !== targetPart) {
        throw new Error(`${label} 的来源媒体关系 ${sourceId} 已被改写`);
      }
      continue;
    }
    if (!relationship.packageTarget || !doc.package?.parts[targetPart]
      || !samePackageTarget(packageTargetIdentity(doc.package, targetPart), relationship.packageTarget)) {
      throw new Error(`${label} 的来源包关系 ${sourceId} 已被改写`);
    }
  }
  const sourcePrimary = mapped.get(source.imageRelationshipId);
  if (!sourcePrimary || sourcePrimary.targetId !== background.imageRelationshipId) {
    throw new Error(`${label} 的来源主图片关系已被改写`);
  }
}

function relationshipSource(doc: EditDoc, record: SlideRecord): Uint8Array | undefined {
  const part = record.origin?.part;
  if (!part || !doc.package) return undefined;
  const direct = doc.package.parts[relationshipPartFor(part)];
  if (direct) return direct;
  const duplicate = record.creation?.duplicateSourcePart;
  if (!duplicate) return undefined;
  const relsPart = relationshipPartFor(duplicate);
  return doc.saveState.baselines[relsPart] ?? doc.package.parts[relsPart];
}

function assertRelationshipTargets(
  doc: EditDoc,
  record: SlideRecord,
  relationships: readonly ElementInsertionRelationship[],
  label: string,
): void {
  const source = relationshipSource(doc, record);
  const existing = new Map((source
    ? xmlElementChildren(parseXmlTree(source).root, { localName: 'Relationship' }) : []).flatMap((node) => {
    const id = findXmlAttribute(node, { localName: 'Id', namespaceUri: null })?.value;
    if (!id) return [];
    return [[id, {
      type: findXmlAttribute(node, { localName: 'Type', namespaceUri: null })?.value,
      target: findXmlAttribute(node, { localName: 'Target', namespaceUri: null })?.value,
      mode: findXmlAttribute(node, { localName: 'TargetMode', namespaceUri: null })?.value,
    }] as const];
  }));
  const active = new Set<string>();
  for (const element of Object.values(doc.elements)) {
    if (element.meta.origin?.part !== record.origin?.part) continue;
    for (const relationship of element.meta.insertion?.relationships ?? []) active.add(relationship.targetId);
    for (const relationship of element.meta.imageReplacement?.relationships ?? []) active.add(relationship.targetId);
  }
  if (record.creation) active.add(record.creation.layoutRelationshipId);
  for (const relationship of relationships) {
    const current = existing.get(relationship.targetId);
    if (current) {
      if (current.type !== relationship.type || current.target !== relationship.target
        || current.mode !== relationship.targetMode) {
        throw new Error(`${label} 的目标关系 ${relationship.targetId} 与 OPC 冲突`);
      }
    } else if (active.has(relationship.targetId)) {
      throw new Error(`${label} 的目标关系 ${relationship.targetId} 与会话资源冲突`);
    }
  }
}

export function assertSlideImageFill(value: unknown, label: string): asserts value is Extract<Fill, { type: 'image' }> {
  assertDataObject(value, ['type', 'src', 'crop', 'alpha', 'tile'], label);
  const fill = value as Partial<Extract<Fill, { type: 'image' }>>;
  if (fill.type !== 'image' || typeof fill.src !== 'string'
    || !/^web-ppt-resource:[0-9a-f]{64}$/.test(fill.src)) {
    throw new Error(`${label} 的图片资源身份无效`);
  }
  if (fill.crop !== undefined) assertImageCrop(fill.crop, `${label}.crop`);
  if (fill.alpha !== undefined
    && (typeof fill.alpha !== 'number' || !Number.isFinite(fill.alpha)
      || fill.alpha < 0 || fill.alpha > 1)) {
    throw new Error(`${label}.alpha 必须是 [0, 1] 内的有限数`);
  }
  normalizeSlideImageTile(fill.tile, `${label}.tile`);
}

export function assertSlideImageBackground(
  value: unknown,
  record: SlideRecord,
  resources: Readonly<Record<string, ElementInsertionResource>>,
  label: string,
  doc: EditDoc,
): asserts value is SlideImageBackground {
  assertDataObject(value, [
    'src', 'relationships', 'resourceHash', 'suppressedRelationshipId',
    'imageRelationshipId', 'resourceHashes', 'sourcePart',
  ], label);
  const background = value as SlideImageBackground;
  if (!Array.isArray(background.relationships) || !background.relationships.length
    || !Array.isArray(background.resourceHashes) || !background.resourceHashes.length
    || background.suppressedRelationshipId !== undefined
    || new Set(background.resourceHashes).size !== background.resourceHashes.length
    || !background.resourceHashes.includes(background.resourceHash)
    || background.resourceHashes.some((hash) => !/^[0-9a-f]{64}$/.test(hash) || !resources[hash])) {
    throw new Error(`${label} 的关系或资源闭包无效`);
  }
  const sourceIds = new Set<string>();
  const targetIds = new Set<string>();
  for (let index = 0; index < background.relationships.length; index++) {
    const input = background.relationships[index];
    assertDataObject(input, ['sourceId', 'targetId', 'type', 'target', 'targetMode'],
      `${label}.relationships[${index}]`);
    const relationship = input as ElementInsertionRelationship;
    const validSourceId = typeof relationship.sourceId === 'string'
      && /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(relationship.sourceId);
    if (!validSourceId || sourceIds.has(relationship.sourceId)
      || !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(relationship.targetId)
      || targetIds.has(relationship.targetId)
      || typeof relationship.type !== 'string' || !relationship.type
      || typeof relationship.target !== 'string' || !relationship.target
      || (relationship.targetMode !== undefined && relationship.targetMode !== 'External')) {
      throw new Error(`${label}.relationships[${index}] 无效`);
    }
    sourceIds.add(relationship.sourceId);
    targetIds.add(relationship.targetId);
  }
  const primary = background.relationships.find((relationship) =>
    relationship.targetId === background.imageRelationshipId);
  const resource = resources[background.resourceHash];
  const allResourcesReferenced = background.resourceHashes.every((hash) =>
    background.relationships.some((relationship) => !relationship.targetMode
      && resolveRelationshipTarget(record.origin!.part, relationship.target) === resources[hash].targetPart));
  if (!primary || !resource || primary.targetMode !== undefined
    || primary.type !== IMAGE_REL
    || !resource.mime.startsWith('image/')
    || !allResourcesReferenced
    || resolveRelationshipTarget(record.origin!.part, primary.target) !== resource.targetPart
    || background.src !== `web-ppt-resource:${resource.hash}`) {
    throw new Error(`${label} 的主图片关系无效`);
  }
  assertSourceClosure(doc, record, background, resources, label);
  assertRelationshipTargets(doc, record, background.relationships, label);
}

/** sourceWidth/sourceHeight 不写入 OOXML；必须由同一图片与 DPI 重算，否则保存重开会跳变。 */
export function assertSlideImageBackgroundDimensions(
  doc: EditDoc,
  record: SlideRecord,
  fill: Extract<Fill, { type: 'image' }>,
  background: SlideImageBackground,
  resources: Readonly<Record<string, ElementInsertionResource>>,
  label: string,
): void {
  if (!fill.tile) return;
  const resource = resources[background.resourceHash];
  if (!resource) throw new Error(`${label} 缺少主图片资源`);
  let bytes: Uint8Array;
  try { bytes = base64ToBytes(resource.bytes); } catch { throw new Error(`${label} 主图片不是有效 Base64`); }
  const metadata = readImageMetadata(bytes);
  if (!metadata) throw new Error(`${label} 主图片缺少物理尺寸`);
  let dpi = 0;
  if (background.sourcePart !== undefined) {
    const source = sourceImageBackground(doc, record);
    const properties = source && findXmlChild(source.background, {
      localName: 'bgPr', namespaceUri: PRESENTATIONML_NS,
    });
    const image = properties && findXmlChild(properties, {
      localName: 'blipFill', namespaceUri: DRAWINGML_NS,
    });
    dpi = Number(image && findXmlAttribute(image, { localName: 'dpi', namespaceUri: null })?.value) || 0;
  }
  const expectedWidth = metadata.width * 96 / (dpi > 0 ? dpi : metadata.dpiX);
  const expectedHeight = metadata.height * 96 / (dpi > 0 ? dpi : metadata.dpiY);
  if (fill.tile.sourceWidth === undefined || fill.tile.sourceHeight === undefined
    || Math.abs(fill.tile.sourceWidth - expectedWidth) > 1e-6
    || Math.abs(fill.tile.sourceHeight - expectedHeight) > 1e-6) {
    throw new Error(`${label} 的平铺来源物理尺寸与图片 DPI 不一致`);
  }
}

export function isSlideBackgroundPatch(patch: Patch): patch is SlideBackgroundPatch {
  return patch.path.length === 4 && patch.path[0] === 'slides'
    && patch.path[2] === 'ovr' && patch.path[3] === 'background';
}

export function isSlideHiddenPatch(patch: Patch): patch is SlideHiddenPatch {
  return patch.path.length === 4 && patch.path[0] === 'slides'
    && patch.path[2] === 'ovr' && patch.path[3] === 'hidden';
}

export function isSlideBackgroundImagePatch(patch: Patch): patch is SlideBackgroundImagePatch {
  return patch.path.length === 3 && patch.path[0] === 'slides'
    && patch.path[2] === 'backgroundImage';
}

export function isSlideTransitionPatch(patch: Patch): patch is SlideTransitionPatch {
  return patch.path.length === 4 && patch.path[0] === 'slides'
    && patch.path[2] === 'ovr' && patch.path[3] === 'transition';
}

export function isSlideAnimationsPatch(patch: Patch): patch is SlideAnimationsPatch {
  return patch.path.length === 4 && patch.path[0] === 'slides'
    && patch.path[2] === 'ovr' && patch.path[3] === 'animations';
}

export function isSlidePropertyPatch(patch: Patch): patch is SlidePropertyPatch {
  return isSlideBackgroundPatch(patch) || isSlideBackgroundImagePatch(patch)
    || isSlideHiddenPatch(patch) || isSlideTransitionPatch(patch) || isSlideAnimationsPatch(patch);
}

export function validateSlidePropertyPatch(
  doc: EditDoc,
  patch: SlidePropertyPatch,
  index: number,
  resources: Readonly<Record<string, ElementInsertionResource>> = doc.imageResources,
): void {
  if (!doc.slides[patch.path[1]]) throw new Error(`Patch 指向不存在的页面：${patch.path[1]}`);
  if (patch.op !== 'set' && patch.op !== 'del') {
    throw new Error(`Patch ${index} 的页面属性操作不受支持`);
  }
  if (patch.op !== 'set') return;
  if (isSlideBackgroundPatch(patch)) {
    if (patch.value.type === 'image') assertSlideImageFill(patch.value, `Patch ${index} 的 background`);
    else assertVectorFill(patch.value, `Patch ${index} 的 background`);
  } else if (isSlideBackgroundImagePatch(patch)) {
    const record = doc.slides[patch.path[1]];
    if (!record.origin?.part) throw new Error(`Patch ${index} 的页面图片背景缺少来源 part`);
    assertSlideImageBackground(patch.value, record, resources, `Patch ${index} 的 backgroundImage`, doc);
  } else if (isSlideTransitionPatch(patch)) {
    assertStoredSlideTransition(patch.value, `Patch ${index} 的 transition`);
  } else if (isSlideAnimationsPatch(patch)) {
    assertStoredSlideAnimations(doc, patch.path[1], patch.value, `Patch ${index} 的 animations`);
  } else if (typeof patch.value !== 'boolean') {
    throw new Error(`Patch ${index} 的 hidden 必须是布尔值`);
  }
}

export function applySlidePropertyPatch(doc: EditDoc, patch: SlidePropertyPatch): void {
  const record = doc.slides[patch.path[1]];
  if (!record) throw new Error(`Patch 指向不存在的页面：${patch.path[1]}`);
  if (isSlideBackgroundPatch(patch)) {
    if (patch.op === 'set') record.ovr.background = structuredClone(patch.value);
    else delete record.ovr.background;
  } else if (isSlideBackgroundImagePatch(patch)) {
    if (patch.op === 'set') record.backgroundImage = structuredClone(patch.value);
    else delete record.backgroundImage;
  } else if (isSlideTransitionPatch(patch)) {
    if (patch.op === 'set') record.ovr.transition = structuredClone(patch.value);
    else delete record.ovr.transition;
  } else if (isSlideAnimationsPatch(patch)) {
    if (patch.op === 'set') record.ovr.animations = structuredClone(patch.value);
    else delete record.ovr.animations;
  } else if (patch.op === 'set') record.ovr.hidden = patch.value;
  else delete record.ovr.hidden;
}
