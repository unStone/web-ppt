import { base64ToBytes, sha256 } from '../clipboard-binary';
import { assertDataObject } from '../data-validation';
import { assertImageCrop, isEditablePicture } from '../image-content';
import type { EditDoc, ElementImageReplacement, ElementInsertionResource } from '../types';
import { resolveRelationshipTarget } from '../clipboard-source';
import type { ElementCropPatch, ElementImageReplacementPatch, ImageResourcePatch, Patch } from './types';
import { validateImageFormat } from './image-format';

const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
interface ValidatedResource {
  readonly targetPart: string;
  readonly hash: string;
  readonly mime: string;
  readonly extension: string;
  readonly bytes: string;
  readonly created: boolean;
}
const validatedResources = new WeakMap<object, ValidatedResource>();

function assertTarget(doc: EditDoc, id: string, index: number): void {
  const record = doc.elements[id];
  if (!record) throw new Error(`Patch 指向不存在的元素：${id}`);
  if (record.src.kind !== 'image' || !isEditablePicture(record.src)
    || record.meta.editable !== 'full') {
    throw new Error(`Patch ${index} 指向不支持图片内容编辑的元素`);
  }
}

export function assertImageReplacement(
  value: unknown,
  sourcePart: string,
  resources: Readonly<Record<string, ElementInsertionResource>>,
  label: string,
): asserts value is ElementImageReplacement {
  assertDataObject(value, ['src', 'relationships', 'resourceHash', 'suppressedRelationshipId'], label);
  const replacement = value as ElementImageReplacement;
  if (!Array.isArray(replacement.relationships) || replacement.relationships.length !== 1) {
    throw new Error(`${label} 必须包含一条图片关系`);
  }
  assertDataObject(replacement.relationships[0], ['sourceId', 'targetId', 'type', 'target', 'targetMode'], `${label}.relationships[0]`);
  const relationship = replacement.relationships[0] as ElementImageReplacement['relationships'][number];
  const resource = resources[replacement.resourceHash];
  if (!relationship.sourceId || !/^rId\d+$/.test(relationship.targetId)
    || relationship.type !== IMAGE_REL || !relationship.target || relationship.targetMode !== undefined
    || !/^[0-9a-f]{64}$/.test(replacement.resourceHash) || !resource
    || resolveRelationshipTarget(sourcePart, relationship.target) !== resource.targetPart
    || replacement.src !== `web-ppt-resource:${resource.hash}`) {
    throw new Error(`${label} 的关系或资源身份无效`);
  }
  if (replacement.suppressedRelationshipId !== undefined
    && (!/^rId\d+$/.test(replacement.suppressedRelationshipId)
      || replacement.suppressedRelationshipId === relationship.targetId)) {
    throw new Error(`${label} 的被替换关系身份无效`);
  }
}

export function assertImageResource(
  value: unknown,
  label: string,
): asserts value is ElementInsertionResource {
  assertDataObject(value, ['targetPart', 'hash', 'mime', 'extension', 'bytes', 'created'], label);
  const resource = value as ElementInsertionResource;
  if (!/^ppt\/media\/[A-Za-z0-9_.-]+$/.test(resource.targetPart)
    || !/^[0-9a-f]{64}$/.test(resource.hash)
    || typeof resource.bytes !== 'string' || typeof resource.created !== 'boolean') {
    throw new Error(`${label} 的媒体身份无效`);
  }
  const cached = validatedResources.get(resource);
  if (cached?.targetPart === resource.targetPart && cached.hash === resource.hash
    && cached.mime === resource.mime && cached.extension === resource.extension
    && cached.bytes === resource.bytes && cached.created === resource.created) return;
  let bytes: Uint8Array;
  try { bytes = base64ToBytes(resource.bytes); } catch { throw new Error(`${label} 不是有效 Base64`); }
  if (sha256(bytes) !== resource.hash) throw new Error(`${label} 的哈希不匹配`);
  const { extension } = validateImageFormat(bytes, resource.mime, label);
  if (extension !== resource.extension) throw new Error(`${label} 的扩展名不匹配`);
  validatedResources.set(resource, {
    targetPart: resource.targetPart, hash: resource.hash, mime: resource.mime,
    extension: resource.extension, bytes: resource.bytes, created: resource.created,
  });
}

function cloneValidatedImageResource(resource: ElementInsertionResource): ElementInsertionResource {
  const clone = structuredClone(resource);
  const cached = validatedResources.get(resource);
  if (cached) validatedResources.set(clone, { ...cached, bytes: clone.bytes });
  return clone;
}

export function isElementCropPatch(patch: Patch): patch is ElementCropPatch {
  return patch.path.length === 4 && patch.path[0] === 'elements'
    && patch.path[2] === 'ovr' && patch.path[3] === 'crop';
}

export function isElementImageReplacementPatch(patch: Patch): patch is ElementImageReplacementPatch {
  return patch.path.length === 4 && patch.path[0] === 'elements'
    && patch.path[2] === 'meta' && patch.path[3] === 'imageReplacement';
}

export function isImageResourcePatch(patch: Patch): patch is ImageResourcePatch {
  return patch.path.length === 2 && patch.path[0] === 'imageResources';
}

export function validateElementCropPatch(doc: EditDoc, patch: ElementCropPatch, index: number): void {
  assertTarget(doc, patch.path[1], index);
  if (patch.op === 'set') assertImageCrop(patch.value, `Patch ${index} 的 crop`);
}

export function validateElementImageReplacementPatch(
  doc: EditDoc,
  patch: ElementImageReplacementPatch,
  index: number,
  resources: Readonly<Record<string, ElementInsertionResource>> = doc.imageResources,
): void {
  assertTarget(doc, patch.path[1], index);
  if (patch.op !== 'set') return;
  const part = doc.elements[patch.path[1]].meta.origin?.part;
  if (!part) throw new Error(`Patch ${index} 的图片缺少来源 part`);
  assertImageReplacement(patch.value, part, resources, `Patch ${index} 的 imageReplacement`);
}

export function validateImageResourcePatch(patch: ImageResourcePatch, index: number): void {
  if (!/^[0-9a-f]{64}$/.test(patch.path[1])) throw new Error(`Patch ${index} 的图片资源路径无效`);
  if (patch.op === 'set') {
    assertImageResource(patch.value, `Patch ${index} 的图片资源`);
    if (patch.value.hash !== patch.path[1]) throw new Error(`Patch ${index} 的图片资源 key 与哈希不一致`);
  }
}

export function applyElementCropPatch(doc: EditDoc, patch: ElementCropPatch): void {
  const record = doc.elements[patch.path[1]];
  if (patch.op === 'set') record.ovr.crop = structuredClone(patch.value);
  else delete record.ovr.crop;
}

export function applyElementImageReplacementPatch(
  doc: EditDoc,
  patch: ElementImageReplacementPatch,
): void {
  const record = doc.elements[patch.path[1]];
  if (patch.op === 'set') record.meta.imageReplacement = structuredClone(patch.value);
  else delete record.meta.imageReplacement;
}

export function applyImageResourcePatch(doc: EditDoc, patch: ImageResourcePatch): void {
  if (patch.op === 'set') doc.imageResources[patch.path[1]] = cloneValidatedImageResource(patch.value);
  else delete doc.imageResources[patch.path[1]];
}
